"""Tests for deterministic demo seeding (Prompt 08)."""

from sqlalchemy import func, select

from app.models import EvidenceExtraction, Paper, Review, ReviewPaper
from app.schemas.evidence_extraction import EvidenceExtractionRead
from app.seed_demo import (
    DATASET,
    DEMO_EXTRACTION_IDS,
    DEMO_PAPER_IDS,
    DEMO_REVIEW_ID,
    DEMO_REVIEW_QUESTION,
    DEMO_REVIEW_TITLE,
    reset_demo,
    seed_demo,
)


def _counts(db) -> tuple[int, int, int, int]:
    return (
        db.scalar(select(func.count()).select_from(Review)),
        db.scalar(select(func.count()).select_from(Paper)),
        db.scalar(select(func.count()).select_from(EvidenceExtraction)),
        db.scalar(select(func.count()).select_from(ReviewPaper)),
    )


def test_seed_creates_expected_rows(db_session) -> None:
    summary = seed_demo(db_session)
    assert summary["papers"] == len(DATASET)
    assert summary["extractions"] == len(DATASET)
    assert _counts(db_session) == (1, len(DATASET), len(DATASET), len(DATASET))


def test_seed_is_idempotent(db_session) -> None:
    seed_demo(db_session)
    counts_before = _counts(db_session)
    summary = seed_demo(db_session)
    assert summary["papers"] == len(DATASET)
    assert _counts(db_session) == counts_before

    review = db_session.get(Review, DEMO_REVIEW_ID)
    assert review is not None
    assert review.title == DEMO_REVIEW_TITLE
    assert review.research_question == DEMO_REVIEW_QUESTION

    links = db_session.scalars(select(ReviewPaper)).all()
    assert len(links) == len(DATASET)
    assert all(link.status == "included" for link in links)


def test_reset_removes_demo_rows(db_session) -> None:
    seed_demo(db_session)
    reset_demo(db_session)
    assert db_session.get(Review, DEMO_REVIEW_ID) is None
    for paper_id in DEMO_PAPER_IDS.values():
        assert db_session.get(Paper, paper_id) is None
    for extraction_id in DEMO_EXTRACTION_IDS.values():
        assert db_session.get(EvidenceExtraction, extraction_id) is None
    assert _counts(db_session) == (0, 0, 0, 0)

    # reseeding after a reset rebuilds the same deterministic dataset
    summary = seed_demo(db_session)
    assert summary["papers"] == len(DATASET)


def test_seeded_extractions_are_schema_valid(db_session) -> None:
    seed_demo(db_session)
    for extraction in db_session.scalars(select(EvidenceExtraction)).all():
        read = EvidenceExtractionRead.model_validate(extraction)
        assert read.origin == "manual"
        assert read.confidence == "high"
        assert read.study_design is not None and len(read.study_design) <= 150
        assert read.sample_size is not None and read.sample_size >= 0


def test_seeded_review_matrix_via_api(client, db_session) -> None:
    seed_demo(db_session)

    response = client.get("/api/reviews")
    assert response.status_code == 200
    reviews = response.json()
    assert any(review["id"] == str(DEMO_REVIEW_ID) for review in reviews)

    matrix = client.get(f"/api/reviews/{DEMO_REVIEW_ID}/matrix")
    assert matrix.status_code == 200
    body = matrix.json()
    assert body["total_papers"] == len(DATASET)
    assert body["included_papers"] == len(DATASET)
    assert all(len(row["extractions"]) == 1 for row in body["papers"])

    evidence = client.get("/api/papers/9742976/evidence")
    assert evidence.status_code == 200
    assert len(evidence.json()) == 1
