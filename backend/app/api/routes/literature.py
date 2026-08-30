"""Routes for PubMed literature search and lookup."""

from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.integrations import pubmed as literature
from app.integrations.pubmed import (
    PubMedApiError,
    PubMedError,
    PubMedNotFoundError,
    PubMedRateLimitError,
    PubMedResponseError,
)
from app.schemas.literature import LiteraturePaper, SearchResponse

router = APIRouter(prefix="/api", tags=["literature"])


def pubmed_error_response(exc: PubMedError) -> HTTPException:
    """Map integration errors to API responses the client can act on."""
    if isinstance(exc, PubMedRateLimitError):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc))
    if isinstance(exc, PubMedNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PubMedApiError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"PubMed API error: {exc}",
        )
    if isinstance(exc, PubMedResponseError):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"PubMed returned a malformed response: {exc}",
        )
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


def _guard_pubmed(operation: Callable[[], SearchResponse | LiteraturePaper]):
    try:
        return operation()
    except PubMedError as exc:
        raise pubmed_error_response(exc) from exc


@router.get("/search", response_model=SearchResponse)
def search_literature(
    q: str = Query(..., min_length=1, max_length=500, description="PubMed search query"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> SearchResponse:
    """Search PubMed, cache results in PostgreSQL, and return a normalized page."""
    if not q.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Query is required"
        )
    return _guard_pubmed(lambda: literature.search_literature(q.strip(), page, page_size, db))


@router.get("/papers/{pmid}", response_model=LiteraturePaper)
def get_paper(
    pmid: int = Path(gt=0, description="PubMed ID"),
    db: Session = Depends(get_db),
) -> LiteraturePaper:
    """Fetch (and cache) a single normalized paper by PMID."""
    return _guard_pubmed(lambda: literature.get_paper(pmid, db))
