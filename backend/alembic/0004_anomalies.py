"""create anomalies table

Revision ID: 0004_anomalies
Revises: 0003_resource_metrics   (adjust to match your latest revision)
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision    = '0004_anomalies'
down_revision = '0003_resource_metrics'   # ← change to your actual previous revision ID
branch_labels = None
depends_on    = None


def upgrade() -> None:
    op.create_table(
        'anomalies',
        sa.Column('id',               sa.Integer(),     nullable=False),
        sa.Column('entity_type',      sa.String(50),    nullable=False),
        sa.Column('entity_name',      sa.String(255),   nullable=False),
        sa.Column('anomaly_type',
                  sa.Enum(
                      'cost_spike', 'high_cpu', 'high_ram',
                      'high_disk', 'resource_spike',
                      name='anomalytype',
                  ),
                  nullable=False),
        sa.Column('severity',
                  sa.Enum('low', 'medium', 'high', 'critical', name='anomalyseverity'),
                  nullable=False),
        sa.Column('method',
                  sa.Enum('statistical', 'isolation_forest', name='anomalymethod'),
                  nullable=False),
        sa.Column('observed_value',   sa.Float(),       nullable=False),
        sa.Column('expected_value',   sa.Float(),       nullable=True),
        sa.Column('std_dev',          sa.Float(),       nullable=True),
        sa.Column('z_score',          sa.Float(),       nullable=True),
        sa.Column('anomaly_score',    sa.Float(),       nullable=True),
        sa.Column('threshold_value',  sa.Float(),       nullable=True),
        sa.Column('threshold_type',   sa.String(50),    nullable=True),
        sa.Column('detected_at',
                  sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at',
                  sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=True),
        sa.Column('description',      sa.Text(),        nullable=True),
        sa.Column('unit',             sa.String(20),    nullable=True),
        sa.Column('source_record_id', sa.Integer(),     nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_anomalies_id',           'anomalies', ['id'],           unique=False)
    op.create_index('ix_anomalies_entity_name',  'anomalies', ['entity_name'],  unique=False)
    op.create_index('ix_anomalies_anomaly_type', 'anomalies', ['anomaly_type'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_anomalies_anomaly_type', table_name='anomalies')
    op.drop_index('ix_anomalies_entity_name',  table_name='anomalies')
    op.drop_index('ix_anomalies_id',           table_name='anomalies')
    op.drop_table('anomalies')
    # Drop enums (PostgreSQL only)
    op.execute("DROP TYPE IF EXISTS anomalytype")
    op.execute("DROP TYPE IF EXISTS anomalyseverity")
    op.execute("DROP TYPE IF EXISTS anomalymethod")