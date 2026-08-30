"""Request/response schemas for reviews."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.evidence_extraction import EvidenceExtractionRead
from app.schemas.review_paper import ReviewPaperStatus


class ReviewCreate(BaseModel):
    """Payload for creating a review.

    ``title`` is mandatory; ``research_question`` is optional so a review can
    be started before its question is fully phrased.
    """

    title: str = Field(min_length=1, max_length=300)
    research_question: str | None = None


class ReviewUpdate(BaseModel):
    """Partial update for a review; omitted fields keep their current value.

    ``research_question`` may be set to ``null`` to clear it; ``title`` cannot
    be cleared.
    """

    title: str | None = Field(default=None, min_length=1, max_length=300)
    research_question: str | None = None


class ReviewRead(ReviewCreate):
    """Review as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class MatrixPaper(BaseModel):
    """A row in the evidence matrix: paper metadata + screening state + evidence."""

    id: UUID
    pmid: int
    title: str
    authors: list[str] = []
    journal: str | None = None
    publication_date: date | None = None
    doi: str | None = None
    url: str | None = None
    status: ReviewPaperStatus
    notes: str | None = None
    extractions: list[EvidenceExtractionRead] = []

    @field_validator("authors", mode="before")
    @classmethod
    def _coerce_missing_authors(cls, value: object) -> object:
        return value if value is not None else []


class ReviewMatrix(BaseModel):
    """A review plus every attached paper and its extracted evidence."""

    review: ReviewRead
    total_papers: int
    included_papers: int
    papers: list[MatrixPaper] = []
