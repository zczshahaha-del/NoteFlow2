from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config


def upgrade_database() -> None:
    server_root = Path(__file__).resolve().parents[1]
    configuration = Config(str(server_root / "alembic.ini"))
    configuration.set_main_option("script_location", str(server_root / "alembic"))
    command.upgrade(configuration, "head")
