import json
import logging.config

import typer
import uvicorn

from candor_api.app import create_app
from candor_api.middleware import logging_config
from candor_api.seed import seed as seed_data
from candor_api.settings import Settings

app = typer.Typer(no_args_is_help=True, pretty_exceptions_enable=False)


def configured_settings() -> Settings:
    initial = Settings()
    return Settings(_env_file=initial.candor_data_dir / "demo" / ".env.local")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    settings = configured_settings()
    uvicorn.run(
        create_app(settings), host=host, port=port, access_log=False, log_config=logging_config()
    )


@app.command()
def seed(reset: bool = False) -> None:
    logging.config.dictConfig(logging_config())
    seed_data(Settings(), reset, warn=lambda message: typer.echo(message, err=True))
    typer.echo("Seed complete. Demo credentials were written to CANDOR_DATA_DIR/demo.")


@app.command()
def openapi() -> None:
    typer.echo(json.dumps(create_app().openapi(), indent=2))


if __name__ == "__main__":
    app()
