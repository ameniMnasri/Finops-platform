"""nullable_cpu_add_server_type

Revision ID: 4862dd7d715e
Revises: a1b2c3d4e5f6
Create Date: 2026-04-10 10:33:14.345263

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '4862dd7d715e'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
