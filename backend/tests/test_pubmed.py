"""Mocked tests for the PubMed/NCBI integration layer.

All NCBI traffic is simulated with ``httpx.MockTransport`` so the suite never
touches the network. Opt-in live tests live in ``test_pubmed_live.py``.
"""

import httpx
import pytest

from app.integrations.pubmed import PubMedClient, search_literature

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


class TestSearch:
    def test_returns_normalized_results(self, client, ncbi, db_session) -> None:
        from sqlalchemy import select

        from app.models import Paper

        resp = client.get("/api/search", params={"q": "diabetes", "page": 1, "page_size": 10})
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["query"] == "diabetes"
        assert payload["page"] == 1
        assert payload["page_size"] == 10
        assert payload["total"] == 1

        item = payload["items"][0]
        assert item["pmid"] == 38657777
        assert item["title"] == "Once-weekly semaglutide in adults with overweight or obesity"
        assert "BACKGROUND: Background text here." in item["abstract"]
        assert item["authors"] == ["John P H Wilding", "Rachel L Battherham"]
        assert item["journal"] == "New England Journal of Medicine"
        assert item["publication_date"] == "2024-05-01"
        assert item["doi"] == "10.1056/NEJMoa2032183"
        assert item["url"] == "https://pubmed.ncbi.nlm.nih.gov/38657777/"

        cached = db_session.scalars(select(Paper)).all()
        assert [p.pmid for p in cached] == [38657777]
        assert cached[0].authors == ["John P H Wilding", "Rachel L Battherham"]

    def test_no_results_returns_empty_page(self, client, ncbi) -> None:
        ncbi._esearch_body = NO_RESULTS_JSON
        resp = client.get("/api/search", params={"q": "qqqzzznotfound", "page": 1})
        assert resp.status_code == 200
        payload = resp.json()
        assert payload["total"] == 0
        assert payload["items"] == []

    @pytest.mark.parametrize("query", ["", "   "])
    def test_empty_query_rejected(self, client, ncbi, query: str) -> None:
        resp = client.get("/api/search", params={"q": query})
        assert resp.status_code == 422

    def test_repeated_request_does_not_duplicate_or_refetch(self, client, ncbi, db_session) -> None:
        from sqlalchemy import select

        from app.models import Paper

        for _ in range(2):
            resp = client.get("/api/search", params={"q": "diabetes", "page_size": 5})
            assert resp.status_code == 200

        assert ncbi.esearch_calls == 2  # page metadata refreshed every request
        assert ncbi.efetch_calls == 1  # cached paper served on the second request
        assert len(db_session.scalars(select(Paper)).all()) == 1  # no duplicate rows


class TestGetPaper:
    def test_fetches_and_caches(self, client, ncbi) -> None:
        resp = client.get("/api/papers/38657777")
        assert resp.status_code == 200
        body = resp.json()
        assert body["pmid"] == 38657777
        assert body["title"].startswith("Once-weekly semaglutide")
        assert ncbi.efetch_calls == 1

        resp = client.get("/api/papers/38657777")
        assert resp.status_code == 200
        assert ncbi.efetch_calls == 1  # served from the DB cache

    def test_unknown_pmid_returns_404(self, client, ncbi) -> None:
        ncbi._articles = {}
        resp = client.get("/api/papers/40404040")
        assert resp.status_code == 404
        assert "No paper found in PubMed" in resp.json()["detail"]

    @pytest.mark.parametrize("pmid", ["abc", "-5", "0"])
    def test_invalid_pmid_rejected(self, client, ncbi, pmid: str) -> None:
        resp = client.get(f"/api/papers/{pmid}")
        assert resp.status_code == 422


class TestEdgeCases:
    def test_missing_abstract_doi_and_authors(self, client, ncbi) -> None:
        ncbi._esearch_body = (
            '{"esearchresult": {"count": "1", "retmax": "1", "retstart": "0", '
            '"idlist": ["99999999"]}}'
        )

        resp = client.get("/api/search", params={"q": "minimal", "page_size": 5})
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["abstract"] is None
        assert item["authors"] == []
        assert item["doi"] is None
        assert item["journal"] == "J Test"
        assert item["publication_date"] == "2023-01-01"  # MedlineDate year fallback


class TestFailures:
    def test_pubmed_unreachable(self, client, ncbi) -> None:
        ncbi._esearch_error = httpx.ConnectError("connection refused")
        resp = client.get("/api/search", params={"q": "diabetes"})
        assert resp.status_code == 502
        assert "PubMed API error" in resp.json()["detail"]

    def test_pubmed_http_error(self, client, ncbi) -> None:
        ncbi._esearch_status = 500
        resp = client.get("/api/search", params={"q": "diabetes"})
        assert resp.status_code == 502

    def test_pubmed_rate_limit(self, client, ncbi) -> None:
        ncbi._esearch_status = 429
        resp = client.get("/api/search", params={"q": "diabetes"})
        assert resp.status_code == 429
        assert "rate limit" in resp.json()["detail"]

    def test_malformed_esearch_json(self, client, ncbi) -> None:
        ncbi._esearch_body = "<html>not json</html>"
        resp = client.get("/api/search", params={"q": "diabetes"})
        assert resp.status_code == 502
        assert "malformed" in resp.json()["detail"]

    def test_malformed_efetch_xml(self, client, ncbi) -> None:
        ncbi._articles = {}
        ncbi._esearch_body = (
            '{"esearchresult": {"count": "1", "retmax": "1", "retstart": "0", '
            '"idlist": ["11111111"]}}'
        )
        ncbi._articles = {"11111111": "<PubmedArticle><broken"}
        resp = client.get("/api/search", params={"q": "diabetes", "page_size": 5})
        assert resp.status_code == 502

    def test_function_rejects_empty_query(self) -> None:
        with pytest.raises(ValueError):
            search_literature("   ")
