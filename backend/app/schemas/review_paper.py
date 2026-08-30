"""Request/response schemas for review–paper links."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ReviewPaperStatus = Literal["pending", "screened", "included", "excluded"]


class ReviewPaperCreate(BaseModel):
    """Attach a paper (by PMID) to a review with a screening status.

    The paper is looked up in the cache or fetched from PubMed if needed.
    """

    pmid: int = Field(gt=0)
    status: ReviewPaperStatus = "pending"
    notes: str | None = Field(default=None, max_length=2000)


class ReviewPaperUpdate(BaseModel):
    """Partial update of a review–paper link (screening status / notes)."""

    status: ReviewPaperStatus | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ReviewPaperRead(BaseModel):
    """Review–paper link as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    review_id: UUID
    paper_id: UUID
    status: ReviewPaperStatus
    notes: str | None
    created_at: datetime
