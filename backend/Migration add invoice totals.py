"""add invoice totals to files table

Revision ID: add_invoice_totals
Revises: (mettre ici l'ID de ta dernière migration)
Create Date: 2026-03-12

USAGE:
    cd backend
    alembic upgrade head
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_invoice_totals'
down_revision = None   # ← remplace par l'ID de ta dernière migration existante
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('files', sa.Column('invoice_total_ht',  sa.Float(),       nullable=True))
    op.add_column('files', sa.Column('invoice_total_ttc', sa.Float(),       nullable=True))
    op.add_column('files', sa.Column('invoice_date',      sa.Date(),        nullable=True))
    op.add_column('files', sa.Column('invoice_reference', sa.String(100),   nullable=True))


def downgrade() -> None:
    op.drop_column('files', 'invoice_reference')
    op.drop_column('files', 'invoice_date')
    op.drop_column('files', 'invoice_total_ttc')
    op.drop_column('files', 'invoice_total_ht')