"""Add resource_metrics table

Revision ID: a1b2c3d4e5f6
Revises: 
Create Date: 2026-04-06

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = None  # ← Set to your last revision ID if you have one
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "resource_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cpu_usage", sa.Float(), nullable=False, comment="CPU usage % (0-100)"),
        sa.Column("ram_usage", sa.Float(), nullable=False, comment="RAM usage in GB"),
        sa.Column("disk_usage", sa.Float(), nullable=False, comment="Disk usage in GB"),
        sa.Column("server_name", sa.String(length=255), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resource_metrics_id", "resource_metrics", ["id"])
    op.create_index("ix_resource_metrics_recorded_at", "resource_metrics", ["recorded_at"])
    op.create_index("ix_resource_metrics_server_name", "resource_metrics", ["server_name"])


def downgrade() -> None:
    op.drop_index("ix_resource_metrics_server_name", table_name="resource_metrics")
    op.drop_index("ix_resource_metrics_recorded_at", table_name="resource_metrics")
    op.drop_index("ix_resource_metrics_id", table_name="resource_metrics")
    op.drop_table("resource_metrics")