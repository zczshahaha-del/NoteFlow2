"""Memory source lifecycle, without a second copy of engine facts."""
from alembic import op
import sqlalchemy as sa
from app.models.db import MemorySource

revision = "20261031_0011"
down_revision = "20260825_0010"
branch_labels = None
depends_on = None


def upgrade():
    MemorySource.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("memory_sources")
