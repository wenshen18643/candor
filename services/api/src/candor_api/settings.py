from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")
    candor_mode: Literal["demo", "production"] = "demo"
    candor_data_dir: Path = Path("data")
    candor_reports_db_url: str = ""
    candor_audit_db_url: str = ""
    candor_payments_db_url: str = ""
    candor_api_url: str = "http://localhost:8000"
    candor_identity_url: str = "http://localhost:8787"
    candor_web_url: str = "http://localhost:3000"
    candor_worker_token: SecretStr = SecretStr("")
    candor_jwt_secret: SecretStr = SecretStr("")
    candor_payments_link_key: SecretStr = SecretStr("")
    candor_identity_admin_token: SecretStr = SecretStr("")
    candor_anchor_every: int = Field(default=16, ge=1)
    x402_mode: Literal["mock", "testnet"] = "mock"
    x402_network: Literal["base-sepolia"] = "base-sepolia"
    x402_pay_to: str = "0x0000000000000000000000000000000000000402"
    x402_facilitator_url: str = "https://x402.org/facilitator"
    x402_price_usd: str = "0.50"
    anchor_mode: Literal["mock", "evm"] = "mock"
    anchor_rpc_url: str = "https://sepolia.base.org"
    anchor_private_key: SecretStr = SecretStr("")
    modal_enabled: bool = False

    @model_validator(mode="after")
    def database_urls(self) -> "Settings":
        for name in ("reports", "audit", "payments"):
            attr = f"candor_{name}_db_url"
            if not getattr(self, attr):
                path = (self.candor_data_dir / f"{name}.db").resolve().as_posix()
                setattr(self, attr, f"sqlite:///{path}")
        urls = [self.candor_reports_db_url, self.candor_audit_db_url, self.candor_payments_db_url]
        identities = []
        for url in urls:
            parsed = make_url(url)
            if parsed.get_backend_name() == "sqlite":
                identities.append(str(Path(parsed.database or "").resolve()).casefold())
            elif parsed.get_backend_name() == "postgresql":
                identities.append(f"{parsed.host}:{parsed.port or 5432}/{parsed.database}")
            else:
                raise ValueError("Only SQLite and PostgreSQL databases are supported")
        if len(set(identities)) != 3:
            raise ValueError("Databases must be separate")
        if self.candor_mode == "production":
            for secret in (
                self.candor_worker_token,
                self.candor_jwt_secret,
                self.candor_payments_link_key,
            ):
                if len(secret.get_secret_value()) < 32 or secret.get_secret_value().startswith(
                    "dev-"
                ):
                    raise ValueError("Production requires strong configured secrets")
            if self.x402_mode == "mock":
                raise ValueError("Production cannot accept mock payments")
            if self.anchor_mode == "mock":
                raise ValueError("Production cannot use mock anchoring")
        return self
