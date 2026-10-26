import hashlib
from typing import Any, Protocol

import httpx
import modal
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from eth_account import Account
from pydantic import BaseModel, Field, model_validator

from candor_api.common import ApiError, require, unb64
from candor_api.settings import Settings


class Issuer(BaseModel):
    key_id: str = Field(pattern=r"^[0-9a-f]{16}$")
    spki: str

    @model_validator(mode="after")
    def valid_key(self) -> "Issuer":
        der = unb64(self.spki)
        key = serialization.load_der_public_key(der)
        if not isinstance(key, rsa.RSAPublicKey) or key.key_size != 2048:
            raise ValueError("Expected RSA-2048 issuer")
        if key.public_numbers().e != 65537 or hashlib.sha256(der).hexdigest()[:16] != self.key_id:
            raise ValueError("Invalid issuer key identifier")
        return self


class IssuerProvider(Protocol):
    def fetch(self, campaign_id: str) -> Issuer: ...


class IdentityClient:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self.settings = settings
        self.client = client

    def fetch(self, campaign_id: str) -> Issuer:
        response = self.client.get(
            f"{self.settings.candor_identity_url}/v1/campaigns/{campaign_id}/issuer"
        )
        if response.status_code == 404 and self.settings.candor_mode == "demo":
            self.register(campaign_id)
            response = self.client.get(
                f"{self.settings.candor_identity_url}/v1/campaigns/{campaign_id}/issuer"
            )
        response.raise_for_status()
        return Issuer.model_validate(response.json())

    def register(self, campaign_id: str) -> None:
        token = self.settings.candor_identity_admin_token.get_secret_value()
        response = self.client.post(
            f"{self.settings.candor_identity_url}/v1/admin/campaigns",
            headers={"Authorization": f"Bearer {token}"},
            json={"campaign_id": campaign_id},
        )
        response.raise_for_status()


class StaticIssuerProvider:
    def __init__(self, issuers: dict[str, Issuer]) -> None:
        self.issuers = issuers

    def fetch(self, campaign_id: str) -> Issuer:
        return self.issuers[campaign_id]


class AnchorAdapter(Protocol):
    def publish(self, root_hash: str) -> tuple[str, str]: ...


class MockAnchor:
    def publish(self, root_hash: str) -> tuple[str, str]:
        return "mock", "0x" + hashlib.sha256(bytes.fromhex(root_hash)).hexdigest()


class EvmAnchor:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self.settings = settings
        self.client = client

    def rpc(self, method: str, params: list[Any]) -> Any:
        response = self.client.post(
            self.settings.anchor_rpc_url,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        )
        response.raise_for_status()
        result = response.json()
        if "error" in result:
            raise ApiError(502, "anchor_failed", "Anchor RPC failed")
        return result["result"]

    def publish(self, root_hash: str) -> tuple[str, str]:
        account = Account.from_key(self.settings.anchor_private_key.get_secret_value())
        chain_id = int(self.rpc("eth_chainId", []), 16)
        require(chain_id == 84532, 503, "wrong_chain", "Anchoring requires Base Sepolia")
        nonce = int(self.rpc("eth_getTransactionCount", [account.address, "pending"]), 16)
        gas_price = int(self.rpc("eth_gasPrice", []), 16)
        gas = int(
            self.rpc(
                "eth_estimateGas",
                [
                    {
                        "from": account.address,
                        "to": account.address,
                        "value": "0x0",
                        "data": "0x" + root_hash,
                    }
                ],
            ),
            16,
        )
        signed = account.sign_transaction(
            {
                "chainId": chain_id,
                "nonce": nonce,
                "to": account.address,
                "value": 0,
                "data": "0x" + root_hash,
                "gas": gas,
                "gasPrice": gas_price,
            }
        )
        tx_ref = self.rpc("eth_sendRawTransaction", ["0x" + signed.raw_transaction.hex()])
        require(
            isinstance(tx_ref, str) and len(tx_ref) == 66,
            502,
            "anchor_failed",
            "Invalid transaction receipt",
        )
        return "base-sepolia", tx_ref


class JobLauncher(Protocol):
    def spawn(self) -> None: ...


class LocalLauncher:
    def spawn(self) -> None:
        return None


class ModalLauncher:
    def spawn(self) -> None:
        modal.Function.from_name("candor", "run_analysis").spawn()
