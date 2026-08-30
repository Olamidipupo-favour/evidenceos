"""Request/response schemas for evidence extractions."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Confidence = Literal["low", "medium", "high"]


class EvidenceExtractionCreate(BaseModel):
    """PICO-structured evidence taken from a single paper."""

    population: str | None = None
    intervention: str | None = None
    comparison: str | None = None
    outcome: str | None = None
    study_design: str | None = Field(default=None, max_length=150)
    sample_size: int | None = Field(default=None, ge=0)
    key_finding: str | None = None
    limitations: str | None = None
    confidence: Confidence | None = None


class EvidenceExtractionRead(EvidenceExtractionCreate):
    """Evidence extraction as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    paper_id: UUID
    created_at: datetime
