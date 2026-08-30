"""Routes for LLM-assisted evidence extraction and per-paper evidence views.

Endpoints accept a paper reference that is either the internal UUID ``id`` or
the PubMed ``pmid``, so the frontend can extract evidence for any paper it has
seen (even before the paper is attached to a review).

Extraction is transactional: the LLM output is validated against the Pydantic
schema and only then persisted. Any failure -- provider unavailable, provider
error, malformed JSON, or schema rejection -- returns a clean HTTP error and
leaves the database untouched.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.integrations import extraction as llm
from app.integrations.extraction import (
    ExtractionError,
    ExtractionProviderError,
    ExtractionResultError,
    ExtractionUnavailableError,
)
from app.models import EvidenceExtraction, Paper
from app.schemas.evidence_extraction import (
    EvidenceExtractionCreate,
    EvidenceExtractionRead,
)

router = APIRouter(prefix="/api/papers", tags=["extraction"])


def _resolve_paper(db: Session, reference: str) -> Paper:
    """Resolve a ``reference`` that is either a paper UUID or a PMID."""
    if reference.isdigit():
        paper = db.scalar(select(Paper).where(Paper.pmid == int(reference)))
        if paper is not None:
            return paper
    else:
        try:
            paper_uuid = UUID(reference)
        except ValueError:
            pass
        else:
            paper = db.get(Paper, paper_uuid)
            if paper is not None:
                return paper
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")


def _extraction_error_response(exc: ExtractionError) -> HTTPException:
    if isinstance(exc, ExtractionUnavailableError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    if isinstance(exc, ExtractionProviderError):
        return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    if isinstance(exc, ExtractionResultError):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Extraction failed: " + str(exc),
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Extraction failed"
    )


@router.post(
    "/{reference}/extract",
    response_model=EvidenceExtractionRead,
    status_code=status.HTTP_201_CREATED,
)
def extract_evidence(
    reference: str,
    db: Session = Depends(get_db),
) -> EvidenceExtraction:
    """Extract structured evidence from a paper's title and abstract.

    The LLM output is validated against ``EvidenceExtractionCreate``. If the
    model invents facts, omits required structure, or the provider is
    unavailable, an error is returned and nothing is persisted.
    """
    paper = _resolve_paper(db, reference)

    if not paper.abstract or not paper.abstract.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This paper has no abstract, so nothing safe can be extracted.",
        )

    try:
        client = llm.get_extraction_client()
    except ExtractionError as exc:
        raise _extraction_error_response(exc) from exc
    except Exception as exc:  # defensive: never crash on provider misconfiguration
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM extraction is not configured.",
        ) from exc

    try:
        raw = client.extract(paper)
    except ExtractionError as exc:
        raise _extraction_error_response(exc) from exc

    try:
        payload = EvidenceExtractionCreate.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The model output failed schema validation; nothing was saved.",
        ) from exc

    extraction = EvidenceExtraction(
        paper_id=paper.id,
        origin="llm",
        model_name=client.model,
        **payload.model_dump(),
    )
    db.add(extraction)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The extraction could not be stored.",
        ) from exc
    db.refresh(extraction)
    return extraction


@router.get("/{reference}/evidence", response_model=list[EvidenceExtractionRead])
def list_paper_evidence(
    reference: str,
    db: Session = Depends(get_db),
) -> list[EvidenceExtraction]:
    """List all evidence extracted for a paper, most recent first."""
    paper = _resolve_paper(db, reference)
    return db.scalars(
        select(EvidenceExtraction)
        .where(EvidenceExtraction.paper_id == paper.id)
        .order_by(EvidenceExtraction.created_at.desc())
    ).all()
