"""add ovh lifecycle date columns to resource_metrics

Revision ID: add_ovh_dates_001
Revises: <your_previous_revision_id>   ← replace with your actual last revision
Create Date: 2026-04-20

Run with:
    alembic upgrade head
Or manually:
    alembic upgrade add_ovh_dates_001
"""

from alembic import op
import sqlalchemy as sa

# ── Identifiers ───────────────────────────────────────────────────────────────
revision = "add_ovh_dates_001"
down_revision = None   # ← replace with your previous revision ID e.g. "abc123def456"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resource_metrics",
        sa.Column("creation_date", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "resource_metrics",
        sa.Column("expiration_date", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "resource_metrics",
        sa.Column("ovh_state", sa.String(), nullable=True),
    )
    op.add_column(
        "resource_metrics",
        sa.Column("ovh_offer", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("resource_metrics", "ovh_offer")
    op.drop_column("resource_metrics", "ovh_state")
    op.drop_column("resource_metrics", "expiration_date")
    op.drop_column("resource_metrics", "creation_date")