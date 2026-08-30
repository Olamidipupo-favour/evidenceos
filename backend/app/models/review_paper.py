"""Association model linking papers to reviews with screening state."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.paper import Paper
    from app.models.review import Review

SCREENING_STATUSES = ("pending", "screened", "included", "excluded")


class ReviewPaper(Base):
    """Join table with per-link state: how a paper was handled in a review."""

    __tablename__ = "review_papers"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'screened', 'included', 'excluded')",
            name="ck_review_papers_status",
        ),
        Index("ix_review_papers_review_id", "review_id"),
        Index("ix_review_papers_paper_id", "paper_id"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reviews.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paper_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    review: Mapped[Review] = relationship(back_populates="review_papers")
    paper: Mapped[Paper] = relationship(back_populates="review_papers")
