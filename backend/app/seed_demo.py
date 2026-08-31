"""Deterministic demo data for the judged walkthrough.

Seeding is fully self-contained: papers and their structured evidence are
embedded as plain data, so provisioning never depends on PubMed or an LLM. This
makes the demo repeatable on a fresh database without any manual repair -- the
deploy command runs ``python -m app.seed_demo`` on every boot.

Everything is idempotent: fixed UUIDs are upserted, so re-running the seed (or
an auto-restart) never produces duplicates. ``--reset`` tears the demo rows
down first, then recreates them.

Run either as a module (``uv run python -m app.seed_demo [--reset]``) or through
the Makefile targets ``make -C backend db-seed`` / ``db-seed-reset``.
"""

from __future__ import annotations

import argparse
import json
import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import EvidenceExtraction, Paper, Review, ReviewPaper

DEMO_REVIEW_ID = uuid.UUID("00000000-0000-4000-8000-00000000d001")
DEMO_REVIEW_TITLE = "Metformin in diabetes — evidence review"
DEMO_REVIEW_QUESTION = (
    "In adults with type 2 or gestational diabetes, does metformin reduce the "
    "risk of major complications compared with conventional treatment or insulin?"
)

# Fixed ids keyed by pmid so reset/seed and review resolution are stable.
DEMO_PAPER_IDS = {
    9742976: uuid.UUID("00000000-0000-4000-8000-00000000d101"),
    18463375: uuid.UUID("00000000-0000-4000-8000-00000000d102"),
}
DEMO_EXTRACTION_IDS = {
    9742976: uuid.UUID("00000000-0000-4000-8000-00000000d201"),
    18463375: uuid.UUID("00000000-0000-4000-8000-00000000d202"),
}

# Papers are PUBLIC records (metadata taken from PubMed); abstracts below are
# short summaries written from published findings, not copied excerpts.
DATASET: dict[int, dict] = {
    9742976: {
        "paper": {
            "title": (
                "Effect of intensive blood-glucose control with metformin on "
                "complications in overweight patients with type 2 diabetes (UKPDS 34)"
            ),
            "abstract": (
                "Overweight patients with newly diagnosed type 2 diabetes were "
                "randomized to intensive glucose control with metformin or conventional "
                "management. Metformin reduced any diabetes-related endpoint by 32%, "
                "diabetes-related death by 42%, and all-cause mortality by 36%, with a "
                "39% reduction in myocardial infarction."
            ),
            "authors": ["UK Prospective Diabetes Study Group"],
            "journal": "The Lancet",
            "publication_date": date(1998, 9, 12),
            "doi": "10.1016/S0140-6736(98)07019-9",
            "url": "https://pubmed.ncbi.nlm.nih.gov/9742976/",
        },
        "extraction": {
            "population": "Overweight adults with newly diagnosed type 2 diabetes",
            "intervention": "Intensive blood-glucose control with metformin 850 mg twice daily",
            "comparison": "Conventional blood-glucose control with diet alone",
            "outcome": (
                "Any diabetes-related endpoint, diabetes-related death, myocardial "
                "infarction, and all-cause mortality"
            ),
            "study_design": "Randomized controlled trial",
            "sample_size": 1704,
            "key_finding": (
                "Metformin reduced diabetes-related endpoints by 32%, diabetes-related "
                "death by 42%, and all-cause mortality by 36% versus conventional management."
            ),
            "limitations": (
                "Open-label trial; findings specific to overweight patients at diagnosis."
            ),
            "confidence": "high",
        },
    },
    18463375: {
        "paper": {
            "title": "Metformin versus Insulin for the Treatment of Gestational Diabetes",
            "abstract": (
                "Women with gestational diabetes mellitus at 20-33 weeks' gestation were "
                "randomized to metformin (with supplemental insulin if required) or insulin. "
                "The composite neonatal outcome occurred at similar rates in both groups, "
                "meeting the criterion for noninferiority, and metformin was accepted by "
                "most women without increasing adverse outcomes."
            ),
            "authors": ["Rowan JA", "Hague WM", "Gao W", "Battin MR", "Moore MP"],
            "journal": "New England Journal of Medicine",
            "publication_date": date(2008, 5, 8),
            "doi": "10.1056/NEJMoa0707193",
            "url": "https://pubmed.ncbi.nlm.nih.gov/18463375/",
        },
        "extraction": {
            "population": "Women with gestational diabetes mellitus (20-33 weeks' gestation)",
            "intervention": "Metformin up to 2500 mg daily, with supplemental insulin as needed",
            "comparison": "Insulin",
            "outcome": (
                "Composite of neonatal hypoglycemia, respiratory distress, phototherapy, "
                "birth trauma, premature birth, or low Apgar score"
            ),
            "study_design": "Randomized, open-label, noninferiority trial",
            "sample_size": 751,
            "key_finding": (
                "Metformin was noninferior to insulin on the composite adverse neonatal "
                "outcome and did not increase the risk of pregnancy complications."
            ),
            "limitations": (
                "Open-label; 46.3% of metformin-assigned women required supplemental insulin."
            ),
            "confidence": "high",
        },
    },
}


def seed_demo(db: Session) -> dict[str, int | str]:
    """Upsert the demo review, papers, links, and extractions. Idempotent."""
    review = db.get(Review, DEMO_REVIEW_ID)
    if review is None:
        review = Review(
            id=DEMO_REVIEW_ID,
            title=DEMO_REVIEW_TITLE,
            research_question=DEMO_REVIEW_QUESTION,
        )
        db.add(review)
    else:
        review.title = DEMO_REVIEW_TITLE
        review.research_question = DEMO_REVIEW_QUESTION

    papers_count = 0
    extractions_count = 0
    for pmid, row in DATASET.items():
        paper_id = DEMO_PAPER_IDS[pmid]
        paper = db.get(Paper, paper_id)
        if paper is None:
            paper = Paper(id=paper_id, pmid=pmid, **row["paper"])
            db.add(paper)
        paper_row: dict = row["paper"]
        paper.title = paper_row["title"]
        paper.abstract = paper_row["abstract"]
        paper.authors = paper_row["authors"]
        paper.journal = paper_row["journal"]
        paper.publication_date = paper_row["publication_date"]
        paper.doi = paper_row["doi"]
        paper.url = paper_row["url"]
        papers_count += 1

        if db.get(ReviewPaper, (review.id, paper.id)) is None:
            db.add(
                ReviewPaper(
                    review_id=review.id,
                    paper_id=paper.id,
                    status="included",
                    notes="Seeded for the demo walkthrough.",
                )
            )

        extraction_id = DEMO_EXTRACTION_IDS[pmid]
        if db.get(EvidenceExtraction, extraction_id) is None:
            db.add(
                EvidenceExtraction(
                    id=extraction_id,
                    paper_id=paper.id,
                    origin="manual",
                    **row["extraction"],
                )
            )
        extractions_count += 1

    db.commit()
    return {
        "review_id": str(review.id),
        "title": review.title,
        "papers": papers_count,
        "extractions": extractions_count,
        "reset": False,
    }


def reset_demo(db: Session) -> None:
    """Delete the demo review, papers, links, and extractions."""
    review = db.get(Review, DEMO_REVIEW_ID)
    if review is not None:
        db.delete(review)
        db.flush()
    for paper_id in DEMO_PAPER_IDS.values():
        paper = db.get(Paper, paper_id)
        if paper is not None:
            db.delete(paper)  # cascades review_papers links and extractions
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision deterministic demo data.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="tear down the demo rows before reseeding",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.reset:
            reset_demo(db)
        summary = seed_demo(db)
        summary["reset"] = args.reset
    finally:
        db.close()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
