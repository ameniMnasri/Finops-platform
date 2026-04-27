"""add mom_temporal to anomalymethod enum

Revision ID: 0005_add_mom_temporal_method
Revises: 0004_anomalies
Create Date: 2026-04-22
"""
from alembic import op

revision      = '0005_add_mom_temporal_method'
down_revision = '0004_anomalies'
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.execute("ALTER TYPE anomalymethod ADD VALUE IF NOT EXISTS 'MOM_TEMPORAL'")


def downgrade() -> None:
    # PostgreSQL ne permet pas de supprimer une valeur d'un type ENUM existant.
    # Pour revenir en arrière : recréer le type sans 'mom_temporal' et migrer les données.
    pass
