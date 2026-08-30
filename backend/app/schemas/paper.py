"""Request/response schemas for papers."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PaperCreate(BaseModel):
    """Payload for creating a paper row from PubMed metadata."""

    pmid: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=500)
    abstract: str | None = None
    authors: str | None = None
    journal: str | None = None
    publication_date: date | None = None
    doi: str | None = Field(default=None, max_length=200)
    url: str | None = Field(default=None, max_length=400)


class PaperRead(PaperCreate):
    """Paper as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
