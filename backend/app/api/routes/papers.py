"""Routes for paper records and their evidence extractions."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import EvidenceExtraction, Paper
from app.schemas.evidence_extraction import (
    EvidenceExtractionCreate,
    EvidenceExtractionRead,
)
from app.schemas.paper import PaperCreate, PaperRead

router = APIRouter(prefix="/papers", tags=["papers"])


@router.post("", response_model=PaperRead, status_code=status.HTTP_201_CREATED)
def create_paper(payload: PaperCreate, db: Session = Depends(get_db)) -> Paper:
    """Create a paper record. PMIDs are unique — duplicates conflict."""
    paper = Paper(**payload.model_dump())
    db.add(paper)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A paper with this PMID already exists",
        ) from None
    db.refresh(paper)
    return paper


@router.get("", response_model=list[PaperRead])
def list_papers(db: Session = Depends(get_db)) -> list[Paper]:
    """List papers, most recently published first."""
    return db.scalars(
        select(Paper).order_by(Paper.publication_date.desc().nulls_last(), Paper.pmid.desc())
    ).all()


@router.get("/{paper_id}", response_model=PaperRead)
def get_paper(paper_id: UUID, db: Session = Depends(get_db)) -> Paper:
    """Fetch a paper by id."""
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return paper


@router.post(
    "/{paper_id}/evidence-extractions",
    response_model=EvidenceExtractionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_evidence_extraction(
    paper_id: UUID,
    payload: EvidenceExtractionCreate,
    db: Session = Depends(get_db),
) -> EvidenceExtraction:
    """Record structured evidence extracted from a paper."""
    if db.get(Paper, paper_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")

    extraction = EvidenceExtraction(paper_id=paper_id, **payload.model_dump())
    db.add(extraction)
    db.commit()
    db.refresh(extraction)
    return extraction


@router.get(
    "/{paper_id}/evidence-extractions",
    response_model=list[EvidenceExtractionRead],
)
def list_evidence_extractions(
    paper_id: UUID, db: Session = Depends(get_db)
) -> list[EvidenceExtraction]:
    """List the evidence extractions recorded for a paper."""
    if db.get(Paper, paper_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    return db.scalars(
        select(EvidenceExtraction).where(EvidenceExtraction.paper_id == paper_id)
    ).all()
