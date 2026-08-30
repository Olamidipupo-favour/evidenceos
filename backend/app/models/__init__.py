"""ORM models for EvidenceOS.

Importing this package registers every table on ``Base.metadata`` so Alembic
autogenerate and ``create_all`` see the full schema.
"""

from app.db.base import Base
from app.models.evidence_extraction import EvidenceExtraction
from app.models.paper import Paper
from app.models.review import Review
from app.models.review_paper import ReviewPaper

__all__ = ["Base", "EvidenceExtraction", "Paper", "Review", "ReviewPaper"]
