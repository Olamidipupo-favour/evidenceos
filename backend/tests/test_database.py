"""Database connectivity and schema tests."""

from sqlalchemy import inspect, text


def test_database_connectivity(db_session) -> None:
    """A trivial query proves the app can reach PostgreSQL."""
    assert db_session.execute(text("SELECT 1")).scalar() == 1


def test_expected_tables_exist(reset_schema) -> None:
    """All four domain tables are present in the schema."""
    inspector = inspect(reset_schema)
    table_names = set(inspector.get_table_names())
    assert {"reviews", "papers", "review_papers", "evidence_extractions"} <= table_names


def test_required_indexes_exist(reset_schema) -> None:
    """The requested indexes are created for papers and review_papers."""
    inspector = inspect(reset_schema)

    paper_indexes = {idx["name"] for idx in inspector.get_indexes("papers")}
    assert {"ix_papers_pmid", "ix_papers_publication_date"} <= paper_indexes

    review_paper_indexes = {idx["name"] for idx in inspector.get_indexes("review_papers")}
    assert {"ix_review_papers_review_id", "ix_review_papers_paper_id"} <= review_paper_indexes


def test_pmid_unique_constraint(db_session) -> None:
    """pmid is unique at the database level, enforced independently of the API."""
    from app.models import Paper

    db_session.add(Paper(pmid=12345, title="First"))
    db_session.commit()

    from sqlalchemy.exc import IntegrityError

    db_session.add(Paper(pmid=12345, title="Duplicate"))
    import pytest

    with pytest.raises(IntegrityError):
        db_session.commit()
