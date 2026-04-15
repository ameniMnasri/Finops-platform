"""make cpu_usage nullable and add server_type

Revision ID: add_server_type_nullable_cpu
Revises: <your_previous_revision_id>
Create Date: 2026-04-10
"""

from alembic import op
import sqlalchemy as sa


def upgrade():
    # 1. Make cpu_usage nullable (was NOT NULL)
    op.alter_column(
        "resource_metrics",
        "cpu_usage",
        existing_type=sa.Float(),
        nullable=True,
    )

    # 2. Add server_type column
    op.add_column(
        "resource_metrics",
        sa.Column("server_type", sa.String(20), nullable=True,
                  comment="VPS or DEDICATED"),
    )


def downgrade():
    op.drop_column("resource_metrics", "server_type")

    # Restore NOT NULL — fill NULLs with 0 first to avoid constraint error
    op.execute("UPDATE resource_metrics SET cpu_usage = 0 WHERE cpu_usage IS NULL")
    op.alter_column(
        "resource_metrics",
        "cpu_usage",
        existing_type=sa.Float(),
        nullable=False,
    )