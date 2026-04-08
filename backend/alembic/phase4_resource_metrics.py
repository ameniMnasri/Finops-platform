"""create resource_metrics table

Revision ID: phase4_resource_metrics
Revises: <your_previous_revision_id>
Create Date: 2026-04-06
"""
from alembic import op
import sqlalchemy as sa

revision = "phase4_resource_metrics"
down_revision = None  # ← replace with your last migration revision ID
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "resource_metrics",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("cpu_usage", sa.Float(), nullable=False),
        sa.Column("ram_usage", sa.Float(), nullable=False),
        sa.Column("disk_usage", sa.Float(), nullable=False),
        sa.Column("server_name", sa.String(255), nullable=True),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    # Index for time-range queries
    op.create_index("ix_resource_metrics_recorded_at", "resource_metrics", ["recorded_at"])
    # Index for server filtering
    op.create_index("ix_resource_metrics_server_name", "resource_metrics", ["server_name"])


def downgrade():
    op.drop_index("ix_resource_metrics_server_name", table_name="resource_metrics")
    op.drop_index("ix_resource_metrics_recorded_at", table_name="resource_metrics")
    op.drop_table("resource_metrics")