"""Model creation and relationship tests."""

import uuid
from datetime import date

from app.models import EvidenceExtraction, Paper, Review, ReviewPaper


class TestReviewModel:
    def test_review_creation(self, db_session) -> None:
        review = Review(
            title="Flu vaccine effectiveness",
            research_question="Do seasonal influenza vaccines reduce mortality?",
        )
        db_session.add(review)
        db_session.commit()

        saved = db_session.get(Review, review.id)
        assert isinstance(saved.id, uuid.UUID)
        assert saved.title == "Flu vaccine effectiveness"
        assert saved.research_question == "Do seasonal influenza vaccines reduce mortality?"
        assert saved.created_at is not None


class TestPaperModel:
    def test_paper_creation(self, db_session) -> None:
        paper = Paper(
            pmid=38657777,
            title="A landmark trial",
            abstract="Abstract text",
            authors="Doe J, Smith A",
            journal="New England Journal of Medicine",
            publication_date=date(2024, 5, 1),
            doi="10.1056/NEJMoa2400000",
            url="https://pubmed.ncbi.nlm.nih.gov/38657777/",
        )
        db_session.add(paper)
        db_session.commit()

        saved = db_session.get(Paper, paper.id)
        assert isinstance(saved.id, uuid.UUID)
        assert saved.pmid == 38657777
        assert saved.title == "A landmark trial"
        assert saved.publication_date == date(2024, 5, 1)
        assert saved.doi == "10.1056/NEJMoa2400000"


class TestRelationships:
    def test_review_paper_relationship(self, db_session) -> None:
        review = Review(title="My review")
        paper = Paper(pmid=20230101, title="Supporting study")
        db_session.add_all([review, paper])
        db_session.commit()

        link = ReviewPaper(
            review_id=review.id,
            paper_id=paper.id,
            status="included",
            notes="Passed full-text screening",
        )
        db_session.add(link)
        db_session.commit()

        # Navigate both relationship directions.
        assert len(review.review_papers) == 1
        assert review.review_papers[0].paper_id == paper.id
        assert len(paper.review_papers) == 1
        assert paper.review_papers[0].review_id == review.id

        fetched = db_session.get(ReviewPaper, (review.id, paper.id))
        assert fetched.status == "included"
        assert fetched.notes == "Passed full-text screening"
        assert fetched.created_at is not None

    def test_paper_evidence_extraction_relationship(self, db_session) -> None:
        paper = Paper(pmid=20230202, title="Intervention study")
        db_session.add(paper)
        db_session.commit()

        extraction = EvidenceExtraction(
            paper_id=paper.id,
            population="Adults aged 65+",
            intervention="Booster dose",
            outcome="All-cause mortality",
            study_design="RCT",
            sample_size=1200,
            confidence="high",
        )
        db_session.add(extraction)
        db_session.commit()

        assert len(paper.evidence_extractions) == 1
        assert paper.evidence_extractions[0].sample_size == 1200
        assert paper.evidence_extractions[0].confidence == "high"
