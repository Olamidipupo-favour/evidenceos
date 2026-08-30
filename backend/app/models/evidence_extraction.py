"""Model for PICO-structured evidence extractions from a paper."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.paper import Paper

CONFIDENCE_LEVELS = ("low", "medium", "high")


class EvidenceExtraction(Base):
    """Structured evidence (PICO + results) taken from a single paper."""

    __tablename__ = "evidence_extractions"
    __table_args__ = (
        CheckConstraint(
            "confidence IN ('low', 'medium', 'high')",
            name="ck_evidence_extractions_confidence",
        ),
        CheckConstraint(
            "sample_size IS NULL OR sample_size >= 0",
            name="ck_evidence_extractions_sample_size",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    population: Mapped[str | None] = mapped_column(Text)
    intervention: Mapped[str | None] = mapped_column(Text)
    comparison: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(Text)
    study_design: Mapped[str | None] = mapped_column(String(150))
    sample_size: Mapped[int | None] = mapped_column(Integer)
    key_finding: Mapped[str | None] = mapped_column(Text)
    limitations: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    paper: Mapped[Paper] = relationship(back_populates="evidence_extractions")
