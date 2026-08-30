"""Model for a publication harvested from PubMed/NCBI."""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Date, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.evidence_extraction import EvidenceExtraction
    from app.models.review_paper import ReviewPaper


class Paper(Base):
    """A deduplicated publication record (PMID-backed)."""

    __tablename__ = "papers"
    __table_args__ = (
        Index("ix_papers_pmid", "pmid", unique=True),
        Index("ix_papers_publication_date", "publication_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pmid: Mapped[int] = mapped_column(BigInteger, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text)
    authors: Mapped[str | None] = mapped_column(Text)
    journal: Mapped[str | None] = mapped_column(String(300))
    publication_date: Mapped[date | None] = mapped_column(Date)
    doi: Mapped[str | None] = mapped_column(String(200))
    url: Mapped[str | None] = mapped_column(String(400))

    review_papers: Mapped[list[ReviewPaper]] = relationship(
        back_populates="paper",
        cascade="all, delete-orphan",
    )
    evidence_extractions: Mapped[list[EvidenceExtraction]] = relationship(
        back_populates="paper",
        cascade="all, delete-orphan",
    )
