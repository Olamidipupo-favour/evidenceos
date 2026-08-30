"""Routes for creating and reading evidence reviews."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Paper, Review, ReviewPaper
from app.schemas.review import ReviewCreate, ReviewRead
from app.schemas.review_paper import ReviewPaperCreate, ReviewPaperRead

router = APIRouter(prefix="/reviews", tags=["reviews"])


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
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    return review


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
    """Attach an existing paper to a review with a screening status."""
    if db.get(Review, review_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if db.get(Paper, payload.paper_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Paper not found")
    if db.get(ReviewPaper, (review_id, payload.paper_id)) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Paper is already attached to this review",
        )

    link = ReviewPaper(
        review_id=review_id,
        paper_id=payload.paper_id,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.get("/{review_id}/papers", response_model=list[ReviewPaperRead])
def list_review_papers(review_id: UUID, db: Session = Depends(get_db)) -> list[ReviewPaper]:
    """List the papers attached to a review."""
    if db.get(Review, review_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    return db.scalars(select(ReviewPaper).where(ReviewPaper.review_id == review_id)).all()
