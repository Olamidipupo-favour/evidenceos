"""Response schemas for literature search."""

from datetime import date

from pydantic import BaseModel, ConfigDict, field_validator


class LiteraturePaper(BaseModel):
    """Normalized publication record returned by the literature API."""

    model_config = ConfigDict(from_attributes=True)

    pmid: int
    title: str
    abstract: str | None = None
    authors: list[str] = []
    journal: str | None = None
    publication_date: date | None = None
    doi: str | None = None
    url: str | None = None

    @field_validator("authors", mode="before")
    @classmethod
    def _normalize_missing_authors(cls, value: object) -> object:
        return value if value is not None else []


class SearchResponse(BaseModel):
    """A page of normalized search results plus pagination metadata."""

    query: str
    page: int
    page_size: int
    total: int
    items: list[LiteraturePaper] = []
