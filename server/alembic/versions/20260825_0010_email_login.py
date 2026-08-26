"""Add passwordless email login and verified-email migration support.

Revision ID: 20260825_0010
Revises: 20260717_0009
Create Date: 2026-08-25
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0010"
down_revision: Union[str, None] = "20260717_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "email_verified_at" not in user_columns:
        op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.alter_column(
        "users",
        "password_hash",
        existing_type=sa.String(length=255),
        nullable=True,
    )

    if "email_login_codes" not in inspector.get_table_names():
        op.create_table(
            "email_login_codes",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.String(length=64), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("code_hash", sa.String(length=64), nullable=False),
            sa.Column("requested_ip", sa.String(length=64), nullable=True),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_email_login_codes_user_id", "email_login_codes", ["user_id"])
        op.create_index("ix_email_login_codes_expires_at", "email_login_codes", ["expires_at"])
        op.create_index("ix_email_login_codes_lookup", "email_login_codes", ["email", "purpose", "created_at"])


def downgrade() -> None:
    # Keeping these columns is safer than destroying passwordless accounts or
    # making their NULL password hashes invalid during a rollback.
    pass
