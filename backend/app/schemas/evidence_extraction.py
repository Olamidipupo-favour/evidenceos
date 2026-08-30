"""Request/response schemas for evidence extractions.

Anti-fabrication rules live here:
- Sentinel strings ("n/a", "Not reported", …) are coerced to ``None`` so the
  persistence layer never stores noise invented by a generator.
- ``sample_size`` only ever accepts a non-negative integer (thousands separators
  stripped); anything else fails validation and nothing is written.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Confidence = Literal["low", "medium", "high"]
ExtractionOrigin = Literal["manual", "llm"]

_SENTINELS = {
    "n/a",
    "na",
    "none",
    "nil",
    "null",
    "unknown",
    "not reported",
    "not applicable",
    "not stated",
    "not mentioned",
    "not available",
    "unavailable",
}


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in _SENTINELS:
        return None
    return text


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

    @field_validator(
        "population",
        "intervention",
        "comparison",
        "outcome",
        "study_design",
        "key_finding",
        "limitations",
        mode="before",
    )
    @classmethod
    def _strip_sentinels(cls, value: object) -> str | None:
        return _clean_text(value)

    @field_validator("sample_size", mode="before")
    @classmethod
    def _coerce_sample_size(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, int):
            return value
        text = str(value).strip().replace(",", "").replace(" ", "")
        if not text or text.lower() in _SENTINELS:
            return None
        if not text.isdigit():
            return value  # let Pydantic reject non-numeric junk
        return int(text)


class EvidenceExtractionRead(EvidenceExtractionCreate):
    """Evidence extraction as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    paper_id: UUID
    origin: ExtractionOrigin = "manual"
    model_name: str | None = None
    created_at: datetime
