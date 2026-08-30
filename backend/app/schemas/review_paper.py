"""Request/response schemas for review–paper links."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ReviewPaperStatus = Literal["pending", "screened", "included", "excluded"]


class ReviewPaperCreate(BaseModel):
    """Attach an existing paper to a review with a screening status."""

    paper_id: UUID
    status: ReviewPaperStatus = "pending"
    notes: str | None = Field(default=None, max_length=2000)


class ReviewPaperRead(BaseModel):
    """Review–paper link as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    review_id: UUID
    paper_id: UUID
    status: ReviewPaperStatus
    notes: str | None
    created_at: datetime
