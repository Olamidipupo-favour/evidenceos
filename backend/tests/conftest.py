"""Shared test fixtures backed by a dedicated PostgreSQL database.

``DATABASE_URL`` is pointed at ``evidenceos_test`` before any application
module is imported so the FastAPI app (engine/session) uses the test database.
"""

# ruff: noqa: E402  # imports below must follow the DATABASE_URL override

import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://evidenceos:evidenceos@localhost:5432/evidenceos_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.integrations.pubmed import PubMedClient
from app.main import app

ESEARCH_JSON = (
    '{"esearchresult": {"count": "1", "retmax": "1", "retstart": "0",  "idlist": ["38657777"]}}'
)

NO_RESULTS_JSON = '{"esearchresult": {"count": "0", "retmax": "0", "retstart": "0", "idlist": []}}'

SEMAGLUTIDE_ARTICLE = """<PubmedArticle>
    <MedlineCitation>
      <PMID>38657777</PMID>
      <Article>
        <Journal>
          <Title>New England Journal of Medicine</Title>
          <ISOAbbreviation>N Engl J Med</ISOAbbreviation>
          <JournalIssue>
            <PubDate><Year>2024</Year><Month>May</Month><Day>1</Day></PubDate>
          </JournalIssue>
        </Journal>
        <ArticleTitle>Once-weekly semaglutide in adults with overweight or obesity</ArticleTitle>
        <Abstract>
          <AbstractText Label="BACKGROUND">Background text here.</AbstractText>
          <AbstractText Label="RESULTS">Results text here.</AbstractText>
        </Abstract>
        <AuthorList>
          <Author><LastName>Wilding</LastName><ForeName>John P H</ForeName>
            <Initials>JPH</Initials></Author>
          <Author><LastName>Battherham</LastName><ForeName>Rachel L</ForeName>
            <Initials>RL</Initials></Author>
        </AuthorList>
        <ELocationID EIdType="doi" ValidYN="Y">10.1056/NEJMoa2032183</ELocationID>
      </Article>
    </MedlineCitation>
    <PubmedData>
      <ArticleIdList>
        <ArticleId IdType="doi">10.1056/NEJMoa2032183</ArticleId>
      </ArticleIdList>
    </PubmedData>
  </PubmedArticle>"""

MINIMAL_ARTICLE = """<PubmedArticle>
    <MedlineCitation>
      <PMID>99999999</PMID>
      <Article>
        <Journal>
          <ISOAbbreviation>J Test</ISOAbbreviation>
          <JournalIssue><PubDate><MedlineDate>2023 Summer</MedlineDate></PubDate></JournalIssue>
        </Journal>
        <ArticleTitle>The minimal record</ArticleTitle>
      </Article>
    </MedlineCitation>
  </PubmedArticle>"""


class FakeNCBI:
    """Mocked esearch/efetch backend aware of the requested PMIDs."""

    def __init__(
        self,
        esearch=ESEARCH_JSON,
        articles: dict[str, str] | None = None,
        esearch_error: Exception | None = None,
        esearch_status: int | None = None,
        efetch_error: Exception | None = None,
    ) -> None:
        self.esearch_calls = 0
        self.efetch_calls = 0
        self._esearch_body = esearch
        self._articles = (
            articles
            if articles is not None
            else {
                "38657777": SEMAGLUTIDE_ARTICLE,
                "99999999": MINIMAL_ARTICLE,
            }
        )
        self._esearch_error = esearch_error
        self._esearch_status = esearch_status
        self._efetch_error = efetch_error

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("esearch.fcgi"):
            self.esearch_calls += 1
            if self._esearch_error is not None:
                raise self._esearch_error
            if self._esearch_status is not None:
                return httpx.Response(self._esearch_status)
            return httpx.Response(200, text=self._esearch_body)
        if request.url.path.endswith("efetch.fcgi"):
            self.efetch_calls += 1
            if self._efetch_error is not None:
                raise self._efetch_error
            ids = request.url.params.get("id", "").split(",")
            content = "".join(self._articles.get(i, "") for i in ids)
            body = f"<PubmedArticleSet>{content}</PubmedArticleSet>"
            return httpx.Response(200, text=body)
        return httpx.Response(404)


@pytest.fixture()
def ncbi(monkeypatch):
    """Patch the PubMed client singleton with a mocked transport."""
    fake = FakeNCBI()

    def _make_client() -> PubMedClient:
        return PubMedClient(
            base_url="https://eutils.test",
            email="engineer@example.com",
            min_interval=0,
            transport=httpx.MockTransport(fake.handler),
        )

    monkeypatch.setattr("app.integrations.pubmed.get_pubmed_client", _make_client)
    return fake


def _admin_engine():
    """A connection to the maintenance DB for CREATE/DROP DATABASE."""
    admin_url = TEST_DATABASE_URL.rsplit("/", 1)[0] + "/postgres"
    return create_engine(admin_url, isolation_level="AUTOCOMMIT")


def _create_test_database() -> None:
    with _admin_engine().connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = 'evidenceos_test'")
        ).scalar()
        if not exists:
            conn.execute(text("CREATE DATABASE evidenceos_test"))


_create_test_database()


@pytest.fixture()
def reset_schema():
    """Drop and recreate all tables against the test database."""
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def db_session(reset_schema):
    """Fresh ORM session on an empty test schema."""
    testing_factory = sessionmaker(bind=reset_schema, autoflush=False, expire_on_commit=False)
    session = testing_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(reset_schema):
    """TestClient backed by the clean test schema."""
    with TestClient(app) as test_client:
        yield test_client
