import json
import secrets
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from nacl.public import PrivateKey
from nacl.signing import SigningKey

from candor_api.app import create_app
from candor_api.common import b64u, uid, unb64
from candor_api.integrations import StaticIssuerProvider
from candor_api.runtime import Runtime
from candor_api.seed import seed
from candor_api.settings import Settings
from tests.helpers import blind_token, box, issuer_for, mock_payment


@pytest.fixture
def tmp_path() -> Path:
    path = Path(__file__).resolve().parents[1] / "data" / "test-runs" / uid()
    path.mkdir(parents=True)
    return path


@dataclass
class Harness:
    runtime: Runtime
    client: TestClient
    rsa_key: rsa.RSAPrivateKey
    identities: list[dict[str, Any]]
    inbox_sig: SigningKey
    inbox_enc: PrivateKey

    def login(self, index: int = 0) -> dict[str, str]:
        identity = self.identities[index]
        reviewer_id = identity["id"]
        response = self.client.post("/v1/auth/challenge", json={"reviewer_id": reviewer_id})
        assert response.status_code == 200
        challenge = response.json()["challenge"]
        key = SigningKey(unb64(identity["sig_sk"])[:32])
        signature = b64u(key.sign(f"candor/v1/auth\n{reviewer_id}\n{challenge}".encode()).signature)
        response = self.client.post(
            "/v1/auth/token",
            json={"reviewer_id": reviewer_id, "challenge": challenge, "signature": signature},
        )
        assert response.status_code == 200
        return {"Authorization": "Bearer " + response.json()["token"]}

    def submission(self) -> dict[str, Any]:
        return {
            "report_id": uid(),
            "campaign_id": "northwind-ethics",
            "token": blind_token(self.rsa_key),
            "evidence_root": "ab" * 32,
            "manifest": box(),
            "files": [{"index": 0, "box": box()}],
            "key_shares": {
                "scheme": "shamir-gf256",
                "threshold": 2,
                "shares": [
                    {"reviewer_id": identity["id"], "sealed_share": b64u(secrets.token_bytes(81))}
                    for identity in self.identities
                ],
            },
            "analysis": {
                "enclave_key_id": self.runtime.enclave()["key_id"],
                "sealed_key": b64u(secrets.token_bytes(80)),
                "box": box(),
            },
            "inbox": {
                "sig_pk": b64u(bytes(self.inbox_sig.verify_key)),
                "enc_pk": b64u(bytes(self.inbox_enc.public_key)),
            },
        }

    def submit(self) -> str:
        response = self.client.post("/v1/reports", json=self.submission())
        assert response.status_code == 201
        return response.json()["report_id"]

    def enqueue(self, report_id: str | None = None) -> str:
        report_id = report_id or self.submit()
        response = self.client.post(
            f"/v1/reports/{report_id}/analysis",
            headers={**self.login(), "X-PAYMENT": mock_payment()},
        )
        assert response.status_code == 202
        return response.json()["job_id"]

    def inbox_login(self) -> dict[str, str]:
        public_key = b64u(bytes(self.inbox_sig.verify_key))
        response = self.client.post("/v1/inbox/challenge", json={"sig_pk": public_key})
        challenge = response.json()["challenge"]
        signature = b64u(
            self.inbox_sig.sign(
                f"candor/v1/inbox-auth\n{public_key}\n{challenge}".encode()
            ).signature
        )
        response = self.client.post(
            "/v1/inbox/session",
            json={"sig_pk": public_key, "challenge": challenge, "signature": signature},
        )
        assert response.status_code == 200
        return {"Authorization": "Bearer " + response.json()["token"]}

    def worker(self, attempt: int | None = None) -> dict[str, str]:
        result = {
            "Authorization": "Bearer "
            + self.runtime.settings.candor_worker_token.get_secret_value()
        }
        if attempt is not None:
            result["X-Job-Attempt"] = str(attempt)
        return result


@pytest.fixture(scope="session")
def rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="session")
def other_rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def harness(
    tmp_path: Path, rsa_key: rsa.RSAPrivateKey, other_rsa_key: rsa.RSAPrivateKey
) -> Iterator[Harness]:
    settings = Settings(
        candor_data_dir=tmp_path,
        candor_worker_token=secrets.token_hex(32),
        candor_jwt_secret=secrets.token_hex(32),
        candor_payments_link_key=secrets.token_hex(32),
        candor_anchor_every=16,
    )
    offline = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503)))
    seed(settings, warn=lambda message: None, client=offline)
    issuers = StaticIssuerProvider(
        {"northwind-ethics": issuer_for(rsa_key), "northwind-safety": issuer_for(other_rsa_key)}
    )
    runtime = Runtime(settings, issuer_provider=issuers)
    identities = json.loads((tmp_path / "demo" / "identities.json").read_text())
    with TestClient(create_app(settings, runtime)) as client:
        yield Harness(
            runtime, client, rsa_key, identities, SigningKey.generate(), PrivateKey.generate()
        )
    runtime.close()
