import json
import secrets
from pathlib import Path
from unittest.mock import Mock

import httpx
import modal
import pytest
import respx
from eth_account import Account
from sqlalchemy import select

from candor_api import tables as t
from candor_api.common import ApiError, uid
from candor_api.database import transaction
from candor_api.integrations import EvmAnchor, IdentityClient, Issuer, ModalLauncher
from candor_api.payments import FacilitatorPayments, PaymentLedger, PaymentPayload, payments
from candor_api.seed import seed
from candor_api.settings import Settings
from tests.conftest import Harness
from tests.helpers import mock_payment


def exact_payload() -> PaymentPayload:
    return PaymentPayload.model_validate(
        {
            "x402Version": 1,
            "scheme": "exact",
            "network": "base-sepolia",
            "payload": {
                "signature": "0x" + "ab" * 65,
                "authorization": {
                    "from": "0x" + "12" * 20,
                    "to": "0x0000000000000000000000000000000000000402",
                    "value": "500000",
                    "validAfter": "0",
                    "validBefore": "2000000000",
                    "nonce": "0x" + "34" * 32,
                },
            },
        }
    )


@respx.mock
def test_real_facilitator_adapter_and_idempotent_settlement(tmp_path: Path) -> None:
    settings = Settings(candor_data_dir=tmp_path, x402_mode="testnet")
    base = settings.x402_facilitator_url
    respx.get(base + "/supported").respond(
        200, json={"kinds": [{"x402Version": 1, "scheme": "exact", "network": "base-sepolia"}]}
    )
    verify = respx.post(base + "/verify").respond(200, json={"isValid": True})
    settle = respx.post(base + "/settle").respond(
        200,
        json={
            "success": True,
            "transaction": "0x" + "56" * 32,
            "network": "base-sepolia",
            "payer": "0x" + "12" * 20,
        },
    )
    with httpx.Client() as client:
        ledger = PaymentLedger(
            settings, secrets.token_bytes(32), FacilitatorPayments(settings, client)
        )
        requirements = ledger.requirements("0.50", "https://api.invalid/analysis")
        job_id = uid()
        assert ledger.charge(job_id, exact_payload(), requirements)["success"]
        assert ledger.charge(job_id, exact_payload(), requirements)["success"]
        assert verify.call_count == 1
        assert settle.call_count == 1
        body = json.loads(verify.calls[0].request.content)
        assert body["x402Version"] == 1
        assert body["paymentRequirements"]["maxAmountRequired"] == "500000"
        assert body["paymentPayload"]["payload"]["authorization"]["validBefore"] == "2000000000"
        ledger.engine.dispose()


@respx.mock
def test_uncertain_settlement_never_charges_twice(tmp_path: Path) -> None:
    settings = Settings(candor_data_dir=tmp_path, x402_mode="testnet")
    base = settings.x402_facilitator_url
    respx.get(base + "/supported").respond(
        200, json={"kinds": [{"x402Version": 1, "scheme": "exact", "network": "base-sepolia"}]}
    )
    respx.post(base + "/verify").respond(200, json={"isValid": True})
    settled = respx.post(base + "/settle").mock(side_effect=httpx.ReadTimeout("synthetic timeout"))
    with httpx.Client() as client:
        ledger = PaymentLedger(
            settings, secrets.token_bytes(32), FacilitatorPayments(settings, client)
        )
        job_id = uid()
        requirements = ledger.requirements("0.50", "https://api.invalid/analysis")
        for _ in range(2):
            with pytest.raises(ApiError, match="payment_pending"):
                ledger.charge(job_id, exact_payload(), requirements)
        assert settled.call_count == 1
        with ledger.engine.connect() as connection:
            assert connection.execute(select(payments.c.status)).scalar_one() == "settling"
        ledger.engine.dispose()


@respx.mock
def test_invalid_facilitator_payment_not_settled(tmp_path: Path) -> None:
    settings = Settings(candor_data_dir=tmp_path, x402_mode="testnet")
    base = settings.x402_facilitator_url
    respx.get(base + "/supported").respond(
        200, json={"kinds": [{"x402Version": 1, "scheme": "exact", "network": "base-sepolia"}]}
    )
    respx.post(base + "/verify").respond(200, json={"isValid": False})
    with httpx.Client() as client:
        ledger = PaymentLedger(
            settings, secrets.token_bytes(32), FacilitatorPayments(settings, client)
        )
        with pytest.raises(ApiError, match="invalid_payment"):
            ledger.charge(
                uid(), exact_payload(), ledger.requirements("0.50", "https://api.invalid/analysis")
            )
        with ledger.engine.connect() as connection:
            assert connection.execute(select(payments)).first() is None
        with pytest.raises(ApiError, match="invalid_payment"):
            ledger.charge(
                uid(),
                ledger.decode(mock_payment()),
                ledger.requirements("0.50", "https://api.invalid/analysis"),
            )
        ledger.engine.dispose()


def test_evm_raw_rpc_signing(tmp_path: Path) -> None:
    account = Account.create()
    settings = Settings(
        candor_data_dir=tmp_path, anchor_mode="evm", anchor_private_key=account.key.hex()
    )
    methods = []

    def rpc(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        method, params = body["method"], body["params"]
        methods.append(method)
        results = {
            "eth_chainId": hex(84532),
            "eth_getTransactionCount": "0x1",
            "eth_gasPrice": "0x1",
            "eth_estimateGas": "0x6000",
        }
        if method == "eth_sendRawTransaction":
            assert Account.recover_transaction(params[0]) == account.address
            result = "0x" + "ab" * 32
        else:
            result = results[method]
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})

    with httpx.Client(transport=httpx.MockTransport(rpc)) as client:
        assert EvmAnchor(settings, client).publish("cd" * 32) == ("base-sepolia", "0x" + "ab" * 32)
    assert methods == [
        "eth_chainId",
        "eth_getTransactionCount",
        "eth_gasPrice",
        "eth_estimateGas",
        "eth_sendRawTransaction",
    ]


def test_modal_spawn_uses_named_function(monkeypatch: pytest.MonkeyPatch) -> None:
    function = Mock()
    lookup = Mock(return_value=function)
    monkeypatch.setattr(modal.Function, "from_name", lookup)
    ModalLauncher().spawn()
    lookup.assert_called_once_with("candor", "run_analysis")
    function.spawn.assert_called_once_with()


def test_seed_offline_and_lazy_issuer_registration(harness: Harness) -> None:
    settings = harness.runtime.settings
    warnings = []
    seed(
        settings,
        warn=warnings.append,
        client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))),
    )
    assert len(warnings) == 2
    assert all("retry" in warning for warning in warnings)
    issuer = harness.runtime.issuers.fetch("northwind-ethics")
    state = {"registered": False}

    def identity(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            state["registered"] = True
            return httpx.Response(201, json={})
        if state["registered"]:
            return httpx.Response(200, json=issuer.model_dump())
        return httpx.Response(404)

    with transaction(harness.runtime.engine) as connection:
        connection.execute(t.campaigns.update().values(issuer_key_id="", issuer_spki=""))
    with httpx.Client(transport=httpx.MockTransport(identity)) as client:
        harness.runtime.issuers = IdentityClient(settings, client)
        response = harness.client.get("/v1/campaigns/northwind-ethics")
        assert response.status_code == 200
        assert state["registered"]
        Issuer.model_validate(response.json()["issuer"])
    assert harness.client.get("/v1/campaigns/northwind-ethics").status_code == 200
