"""store paper authors as a jsonb list

Revision ID: 8c2a17be3f1d
Revises: 299e617f254d
Create Date: 2026-08-30 20:15:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c2a17be3f1d"
down_revision: str | Sequence[str] | None = "299e617f254d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "papers",
        "authors",
        existing_type=sa.Text(),
        type_=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=True,
        postgresql_using="authors::jsonb",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "papers",
        "authors",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        type_=sa.Text(),
        existing_nullable=True,
        postgresql_using="authors::text",
    )
