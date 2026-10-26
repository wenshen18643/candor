import base64
import hashlib
import hmac
import json
from decimal import Decimal
from typing import Annotated, Any, Literal, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import Column, MetaData, String, Table, select

from candor_api.common import ApiError, bucket, canonical, require, uid
from candor_api.database import make_engine, transaction
from candor_api.settings import Settings

Address = Annotated[str, Field(pattern=r"^0x[0-9a-fA-F]{40}$")]
Nonce = Annotated[str, Field(pattern=r"^0x[0-9a-fA-F]{64}$")]


class Authorization(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    sender: Address = Field(alias="from")
    to: Address
    value: str = Field(pattern=r"^[0-9]+$")
    valid_after: str = Field(alias="validAfter", pattern=r"^[0-9]+$")
    valid_before: str = Field(alias="validBefore", pattern=r"^[0-9]+$")
    nonce: Nonce


class ExactPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    signature: str = Field(pattern=r"^0x[0-9a-fA-F]{130}$")
    authorization: Authorization


class MockPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mock: Literal[True]
    payer: Address
    nonce: Nonce


class PaymentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x402_version: Literal[1] = Field(default=1, alias="x402Version")
    scheme: Literal["exact"] = "exact"
    network: Literal["base-sepolia"] = "base-sepolia"
    payload: MockPayload | ExactPayload

    def identity(self) -> tuple[str, str]:
        if isinstance(self.payload, MockPayload):
            return self.payload.payer.lower(), self.payload.nonce.lower()
        return self.payload.authorization.sender.lower(), self.payload.authorization.nonce.lower()


class Settlement(BaseModel):
    success: bool
    transaction: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    network: Literal["base-sepolia"]
    payer: Address


class PaymentAdapter(Protocol):
    def settle(self, payload: PaymentPayload, requirements: dict[str, Any]) -> Settlement: ...


class MockPayments:
    def settle(self, payload: PaymentPayload, requirements: dict[str, Any]) -> Settlement:
        require(
            isinstance(payload.payload, MockPayload),
            402,
            "invalid_payment",
            "Mock payment required",
        )
        payer, nonce = payload.identity()
        return Settlement(
            success=True,
            transaction="0x"
            + hashlib.sha256(
                canonical([payer, nonce, requirements["maxAmountRequired"]])
            ).hexdigest(),
            network=payload.network,
            payer=payer,
        )


class FacilitatorPayments:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self.settings = settings
        self.client = client

    def settle(self, payload: PaymentPayload, requirements: dict[str, Any]) -> Settlement:
        require(
            isinstance(payload.payload, ExactPayload),
            402,
            "invalid_payment",
            "Signed payment required",
        )
        authorization = payload.payload.authorization
        require(
            authorization.to.lower() == requirements["payTo"].lower()
            and authorization.value == requirements["maxAmountRequired"],
            402,
            "invalid_payment",
            "Payment does not match the quoted requirements",
        )
        body = {
            "x402Version": 1,
            "paymentPayload": payload.model_dump(by_alias=True),
            "paymentRequirements": requirements,
        }
        base = self.settings.x402_facilitator_url.rstrip("/")
        supported = self.client.get(base + "/supported")
        supported.raise_for_status()
        require(
            any(
                kind.get("x402Version") == 1
                and kind.get("scheme") == "exact"
                and kind.get("network") == requirements["network"]
                for kind in supported.json().get("kinds", [])
            ),
            503,
            "unsupported_payment",
            "Facilitator does not support the required payment scheme",
        )
        verified = self.client.post(base + "/verify", json=body)
        verified.raise_for_status()
        require(
            verified.json().get("isValid") is True,
            402,
            "invalid_payment",
            "Payment verification failed",
        )
        settled = self.client.post(base + "/settle", json=body)
        settled.raise_for_status()
        result = Settlement.model_validate(settled.json())
        require(
            result.success and result.payer.lower() == payload.identity()[0],
            402,
            "settlement_failed",
            "Payment settlement failed",
        )
        return result


metadata = MetaData()
payments = Table(
    "payments",
    metadata,
    Column("id", String, primary_key=True),
    Column("scheme", String, nullable=False),
    Column("network", String, nullable=False),
    Column("asset", String, nullable=False),
    Column("amount_atomic", String, nullable=False),
    Column("payer", String, nullable=False),
    Column("status", String, nullable=False),
    Column("tx_ref", String),
    Column("facilitator", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("job_link", String, unique=True, nullable=False),
    Column("nonce_tag", String, unique=True, nullable=False),
)


class PaymentLedger:
    def __init__(self, settings: Settings, link_key: bytes, adapter: PaymentAdapter) -> None:
        self.settings = settings
        self.key = link_key
        self.adapter = adapter
        self.engine = make_engine(settings.candor_payments_db_url)
        metadata.create_all(self.engine)

    def digest(self, value: str) -> str:
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()

    def requirements(self, price: str, resource: str) -> dict[str, Any]:
        amount = Decimal(price) * 1_000_000
        require(
            amount > 0 and amount == amount.to_integral_value(),
            503,
            "invalid_price",
            "Invalid analysis price",
        )
        return {
            "scheme": "exact",
            "network": self.settings.x402_network,
            "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "maxAmountRequired": str(int(amount)),
            "payTo": self.settings.x402_pay_to,
            "resource": resource,
            "description": "Candor encrypted report analysis",
            "mimeType": "application/json",
            "maxTimeoutSeconds": 300,
            "extra": {"name": "USDC", "version": "2"},
        }

    def decode(self, header: str) -> PaymentPayload:
        require(len(header) <= 16384, 402, "invalid_payment", "Invalid payment header")
        try:
            raw = base64.b64decode(header + "=" * (-len(header) % 4), altchars=b"-_", validate=True)
            return PaymentPayload.model_validate_json(raw)
        except (ValueError, ValidationError) as error:
            raise ApiError(402, "invalid_payment", "Invalid payment header") from error

    def charge(
        self, job_id: str, payload: PaymentPayload, requirements: dict[str, Any]
    ) -> dict[str, Any]:
        link = self.digest(job_id)
        payer, nonce = payload.identity()
        nonce_tag = self.digest("nonce/" + payer + "/" + nonce)
        with transaction(self.engine) as connection:
            existing = (
                connection.execute(select(payments).where(payments.c.job_link == link))
                .mappings()
                .first()
            )
            if existing:
                require(
                    existing["status"] == "settled",
                    409,
                    "payment_pending",
                    "Settlement requires reconciliation",
                )
                return self.receipt(dict(existing))
            used = connection.execute(
                select(payments.c.id).where(payments.c.nonce_tag == nonce_tag)
            ).first()
            require(not used, 409, "payment_replayed", "Payment already assigned to another job")
            row = {
                "id": uid(),
                "scheme": "exact",
                "network": requirements["network"],
                "asset": requirements["asset"],
                "amount_atomic": requirements["maxAmountRequired"],
                "payer": payer,
                "status": "settling",
                "tx_ref": None,
                "facilitator": "mock"
                if self.settings.x402_mode == "mock"
                else self.settings.x402_facilitator_url,
                "created_at": bucket(),
                "job_link": link,
                "nonce_tag": nonce_tag,
            }
            connection.execute(payments.insert().values(**row))
        try:
            result = self.adapter.settle(payload, requirements)
        except ApiError as error:
            if error.code == "invalid_payment":
                with transaction(self.engine) as connection:
                    connection.execute(payments.delete().where(payments.c.id == row["id"]))
            raise
        except (httpx.HTTPError, ValueError) as error:
            raise ApiError(
                503, "payment_pending", "Settlement outcome requires reconciliation"
            ) from error
        row.update(status="settled", tx_ref=result.transaction)
        with transaction(self.engine) as connection:
            connection.execute(
                payments.update()
                .where(payments.c.id == row["id"])
                .values(status="settled", tx_ref=result.transaction)
            )
        return self.receipt(row)

    def receipt(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "success": True,
            "transaction": row["tx_ref"],
            "network": row["network"],
            "payer": row["payer"],
        }

    def get_receipt(self, job_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    select(payments).where(payments.c.job_link == self.digest(job_id))
                )
                .mappings()
                .one()
            )
            return self.receipt(dict(row))

    def summaries(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(payments.c.amount_atomic, payments.c.status)
            ).mappings()
            return [dict(row) for row in rows]


def receipt_header(receipt: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(receipt, separators=(",", ":")).encode()).decode()
