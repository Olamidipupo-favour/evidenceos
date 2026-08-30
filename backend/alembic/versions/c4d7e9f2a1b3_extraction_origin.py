"""track extraction origin (manual vs llm) and model name

Revision ID: c4d7e9f2a1b3
Revises: 8c2a17be3f1d
Create Date: 2026-08-30 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4d7e9f2a1b3"
down_revision: str | Sequence[str] | None = "8c2a17be3f1d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema: distinguish reported evidence from generated interpretation."""
    op.add_column(
        "evidence_extractions",
        sa.Column("origin", sa.String(length=10), server_default="manual", nullable=False),
    )
    op.add_column(
        "evidence_extractions",
        sa.Column("model_name", sa.String(length=120), nullable=True),
    )
    op.create_check_constraint(
        "ck_evidence_extractions_origin",
        "evidence_extractions",
        "origin IN ('manual', 'llm')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_evidence_extractions_origin", "evidence_extractions", type_="check")
    op.drop_column("evidence_extractions", "model_name")
    op.drop_column("evidence_extractions", "origin")
