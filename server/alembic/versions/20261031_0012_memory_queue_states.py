"""Keep managed memory jobs invisible to older generic outbox workers."""
from alembic import op

revision = "20261031_0012"
down_revision = "20261031_0011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE integration_outbox SET status='memory_pending' WHERE topic IN ('memory.retain.requested','memory.source.delete') AND status='pending'")
    op.execute("UPDATE integration_outbox SET status='memory_processing' WHERE topic IN ('memory.retain.requested','memory.source.delete') AND status='processing'")


def downgrade():
    op.execute("UPDATE integration_outbox SET status='pending' WHERE status='memory_pending'")
    op.execute("UPDATE integration_outbox SET status='processing' WHERE status='memory_processing'")
