"""Request/response schemas for reviews."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ReviewCreate(BaseModel):
    """Payload for creating a review.

    ``title`` is mandatory; ``research_question`` is optional so a review can
    be started before its question is fully phrased.
    """

    title: str = Field(min_length=1, max_length=300)
    research_question: str | None = None


class ReviewRead(ReviewCreate):
    """Review as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
