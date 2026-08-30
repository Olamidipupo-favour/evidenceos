"""Routes for the evidence review workspace.

A review is a container for a research question plus a set of screening links
to papers (``review_papers``). Papers are addressed by PMID and cached on
attach through the PubMed integration.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.routes.literature import pubmed_error_response
from app.db.session import get_db
from app.integrations import pubmed as literature
from app.integrations.pubmed import PubMedError, PubMedNotFoundError
from app.models import EvidenceExtraction, Paper, Review, ReviewPaper
from app.schemas.evidence_extraction import EvidenceExtractionRead
from app.schemas.review import MatrixPaper, ReviewCreate, ReviewMatrix, ReviewRead, ReviewUpdate
from app.schemas.review_paper import ReviewPaperCreate, ReviewPaperRead, ReviewPaperUpdate

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def _review_or_404(db: Session, review_id: UUID) -> Review:
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    return review


def _link_or_404(db: Session, review_id: UUID, paper_id: UUID) -> ReviewPaper:
    link = db.get(ReviewPaper, (review_id, paper_id))
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Paper is not attached to this review",
        )
    return link


@router.post("", response_model=ReviewRead, status_code=status.HTTP_201_CREATED)
def create_review(payload: ReviewCreate, db: Session = Depends(get_db)) -> Review:
    """Create a new evidence review."""
    review = Review(**payload.model_dump())
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@router.get("", response_model=list[ReviewRead])
def list_reviews(db: Session = Depends(get_db)) -> list[Review]:
    """List reviews, newest first."""
    return db.scalars(select(Review).order_by(Review.created_at.desc())).all()


@router.get("/{review_id}", response_model=ReviewRead)
def get_review(review_id: UUID, db: Session = Depends(get_db)) -> Review:
    """Fetch a review by id."""
    return _review_or_404(db, review_id)


@router.patch("/{review_id}", response_model=ReviewRead)
def update_review(review_id: UUID, payload: ReviewUpdate, db: Session = Depends(get_db)) -> Review:
    """Partially update a review (title and/or research question)."""
    review = _review_or_404(db, review_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "title" and value is None:
            continue  # title is not cleared via PATCH
        setattr(review, field, value)
    db.commit()
    db.refresh(review)
    return review


@router.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(review_id: UUID, db: Session = Depends(get_db)) -> None:
    """Delete a review and its paper links (cascade)."""
    review = _review_or_404(db, review_id)
    db.delete(review)
    db.commit()


@router.post(
    "/{review_id}/papers",
    response_model=ReviewPaperRead,
    status_code=status.HTTP_201_CREATED,
)
def attach_paper(
    review_id: UUID,
    payload: ReviewPaperCreate,
    db: Session = Depends(get_db),
) -> ReviewPaper:
    """Attach a paper (by PMID) to a review, fetching it from PubMed if needed."""
    _review_or_404(db, review_id)

    paper = db.scalar(select(Paper).where(Paper.pmid == payload.pmid))
    if paper is None:
        try:
            literature.get_paper(payload.pmid, db=db)
        except PubMedNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found in PubMed"
            ) from None
        except PubMedError as exc:
            raise pubmed_error_response(exc) from exc
        paper = db.scalar(select(Paper).where(Paper.pmid == payload.pmid))
        if paper is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found in PubMed"
            )

    if db.get(ReviewPaper, (review_id, paper.id)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Paper is already attached to this review",
        )

    link = ReviewPaper(
        review_id=review_id,
        paper_id=paper.id,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.get("/{review_id}/papers", response_model=list[ReviewPaperRead])
def list_review_papers(review_id: UUID, db: Session = Depends(get_db)) -> list[ReviewPaper]:
    """List the screening links for a review."""
    _review_or_404(db, review_id)
    return db.scalars(select(ReviewPaper).where(ReviewPaper.review_id == review_id)).all()


@router.patch("/{review_id}/papers/{paper_id}", response_model=ReviewPaperRead)
def update_review_paper(
    review_id: UUID,
    paper_id: UUID,
    payload: ReviewPaperUpdate,
    db: Session = Depends(get_db),
) -> ReviewPaper:
    """Update a link's screening status and/or notes."""
    link = _link_or_404(db, review_id, paper_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "status" and value is None:
            continue  # status is never cleared via PATCH
        setattr(link, field, value)
    db.commit()
    db.refresh(link)
    return link


@router.delete(
    "/{review_id}/papers/{paper_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_review_paper(review_id: UUID, paper_id: UUID, db: Session = Depends(get_db)) -> None:
    """Remove a paper from a review."""
    link = _link_or_404(db, review_id, paper_id)
    db.delete(link)
    db.commit()


@router.get("/{review_id}/matrix", response_model=ReviewMatrix)
def review_matrix(review_id: UUID, db: Session = Depends(get_db)) -> ReviewMatrix:
    """Return the evidence matrix: every paper plus its extracted evidence."""
    review = _review_or_404(db, review_id)
    links = db.scalars(
        select(ReviewPaper)
        .where(ReviewPaper.review_id == review_id)
        .order_by(ReviewPaper.created_at, ReviewPaper.paper_id)
    ).all()
    if not links:
        return ReviewMatrix(
            review=ReviewRead.model_validate(review),
            total_papers=0,
            included_papers=0,
            papers=[],
        )

    paper_ids = [link.paper_id for link in links]
    papers = {paper.id: paper for paper in db.scalars(select(Paper).where(Paper.id.in_(paper_ids)))}

    extractions: dict[UUID, list[EvidenceExtractionRead]] = {}
    for extraction in db.scalars(
        select(EvidenceExtraction)
        .where(EvidenceExtraction.paper_id.in_(paper_ids))
        .order_by(EvidenceExtraction.created_at)
    ):
        extractions.setdefault(extraction.paper_id, []).append(
            EvidenceExtractionRead.model_validate(extraction)
        )

    rows = [
        MatrixPaper(
            id=paper.id,
            pmid=paper.pmid,
            title=paper.title,
            authors=paper.authors or [],
            journal=paper.journal,
            publication_date=paper.publication_date,
            doi=paper.doi,
            url=paper.url,
            status=link.status,
            notes=link.notes,
            extractions=extractions.get(paper.id, []),
        )
        for link in links
        for paper in [papers[link.paper_id]]
    ]
    return ReviewMatrix(
        review=ReviewRead.model_validate(review),
        total_papers=len(rows),
        included_papers=sum(1 for row in rows if row.status == "included"),
        papers=rows,
    )
