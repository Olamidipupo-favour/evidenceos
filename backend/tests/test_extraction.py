"""Tests for LLM-assisted evidence extraction (Prompt 06).

The extraction endpoints resolve papers by UUID or PMID, validate model output
against the Pydantic schema before persisting, and never write a row when the
provider (or the model) fails. ``get_extraction_client`` is stubbed here so no
real API is contacted.
"""

from app.integrations.extraction import (
    ExtractionProviderError,
    ExtractionResultError,
    ExtractionUnavailableError,
)

GOOD_ABSTRACT = (
    "BACKGROUND: Evidence on SGLT2 inhibitors is limited. METHODS: We randomly assigned 4744 "
    "adults with type 2 diabetes to dapagliflozin or placebo. RESULTS: The hazard ratio for the "
    "3-point MACE composite was 0.86 (95% CI 0.73-1.00)."
)

VALID_FIELDS = {
    "population": "Adults with type 2 diabetes",
    "intervention": "Dapagliflozin 10 mg",
    "comparison": "Placebo",
    "outcome": "3-point MACE",
    "study_design": "Randomized controlled trial",
    "sample_size": 4744,
    "key_finding": "HR 0.86 (95% CI 0.73-1.00) for MACE",
    "limitations": "Open label follow-up",
    "confidence": "high",
}


def _cache_paper(client, pmid: int = 1000, *, abstract: str | None = None) -> dict:
    body = {"pmid": pmid, "title": f"Paper {pmid}"}
    if abstract is not None:
        body["abstract"] = abstract
    resp = client.post("/papers", json=body)
    assert resp.status_code == 201
    return resp.json()


def _patch_extraction_client(monkeypatch, handler):
    class FakeClient:
        model = "gpt-fake"

        def extract(self, paper):
            return handler(paper)

    monkeypatch.setattr("app.integrations.extraction.get_extraction_client", lambda: FakeClient())


class TestExtractEndpoint:
    def test_extract_returns_structured_evidence(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)
        seen: list[str] = []

        def handler(paper):
            seen.append(paper.title)
            return dict(VALID_FIELDS)

        _patch_extraction_client(monkeypatch, handler)

        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 201
        body = resp.json()
        assert body["origin"] == "llm"
        assert body["model_name"] == "gpt-fake"
        assert body["population"] == "Adults with type 2 diabetes"
        assert body["sample_size"] == 4744
        assert body["confidence"] == "high"
        assert seen == ["Paper 1000"]

        evidence = client.get(f"/api/papers/{paper['id']}/evidence")
        assert evidence.status_code == 200
        assert len(evidence.json()) == 1
        assert evidence.json()[0]["id"] == body["id"]

    def test_extract_resolves_paper_by_pmid(self, client, monkeypatch) -> None:
        _cache_paper(client, abstract=GOOD_ABSTRACT)
        _patch_extraction_client(monkeypatch, lambda paper: dict(VALID_FIELDS))

        resp = client.post("/api/papers/1000/extract")
        assert resp.status_code == 201
        assert resp.json()["origin"] == "llm"
        evidence = client.get("/api/papers/1000/evidence").json()
        assert evidence[0]["paper_id"] == resp.json()["paper_id"]

    def test_unknown_paper_returns_404(self, client, monkeypatch) -> None:
        _patch_extraction_client(monkeypatch, lambda paper: dict(VALID_FIELDS))
        resp = client.post("/api/papers/999999/extract")
        assert resp.status_code == 404

    def test_paper_without_abstract_is_rejected(self, client, monkeypatch) -> None:
        paper = _cache_paper(client)

        def handler(paper):
            raise AssertionError("extraction client must not be called")

        _patch_extraction_client(monkeypatch, handler)
        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 422
        assert "no abstract" in resp.json()["detail"].lower()

    def test_sentinel_values_are_stored_as_null(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)
        _patch_extraction_client(
            monkeypatch,
            lambda paper: {
                "population": "N/A",
                "intervention": "Not reported",
                "comparison": "not applicable",
                "outcome": "",
                "study_design": "unknown",
                "sample_size": None,
                "key_finding": "Not reported (mock)",
                "limitations": None,
                "confidence": None,
            },
        )

        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 201
        body = resp.json()
        assert body["population"] is None
        assert body["intervention"] is None
        assert body["comparison"] is None
        assert body["outcome"] is None
        assert body["study_design"] is None
        assert body["sample_size"] is None
        assert body["confidence"] is None
        assert body["key_finding"] == "Not reported (mock)"  # real text is kept

    def test_non_numeric_sample_size_fails_validation_without_persisting(
        self, client, monkeypatch
    ) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)

        def handler(paper):
            invalid = dict(VALID_FIELDS)
            invalid["sample_size"] = "large"
            return invalid

        _patch_extraction_client(monkeypatch, handler)

        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 422
        assert client.get(f"/api/papers/{paper['id']}/evidence").json() == []

    def test_invalid_confidence_fails_validation(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)

        def handler(paper):
            invalid = dict(VALID_FIELDS)
            invalid["confidence"] = "certain"
            return invalid

        _patch_extraction_client(monkeypatch, handler)
        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 422
        assert client.get(f"/api/papers/{paper['id']}/evidence").json() == []

    def test_malformed_json_from_provider_returns_422(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)

        def handler(paper):
            raise ExtractionResultError("The model did not return valid JSON; nothing was saved")

        _patch_extraction_client(monkeypatch, handler)
        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 422
        assert client.get(f"/api/papers/{paper['id']}/evidence").json() == []

    def test_unconfigured_provider_returns_503(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)

        def handler(paper):
            raise ExtractionUnavailableError("LLM extraction is not configured")

        _patch_extraction_client(monkeypatch, handler)
        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 503
        assert "not configured" in resp.json()["detail"]
        assert client.get(f"/api/papers/{paper['id']}/evidence").json() == []

    def test_provider_error_returns_502(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)

        def handler(paper):
            raise ExtractionProviderError("could not reach the LLM provider")

        _patch_extraction_client(monkeypatch, handler)
        resp = client.post(f"/api/papers/{paper['id']}/extract")
        assert resp.status_code == 502
        assert client.get(f"/api/papers/{paper['id']}/evidence").json() == []

    def test_failure_does_not_corrupt_subsequent_extraction(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)
        calls = {"n": 0}

        def handler(paper):
            if calls["n"] == 0:
                calls["n"] += 1
                raise ExtractionResultError("bad json")
            calls["n"] += 1
            return dict(VALID_FIELDS)

        _patch_extraction_client(monkeypatch, handler)

        first = client.post(f"/api/papers/{paper['id']}/extract")
        assert first.status_code == 422

        second = client.post(f"/api/papers/{paper['id']}/extract")
        assert second.status_code == 201

        evidence = client.get(f"/api/papers/{paper['id']}/evidence").json()
        assert len(evidence) == 1
        assert evidence[0]["id"] == second.json()["id"]


class TestEvidenceView:
    def test_evidence_list_is_newest_first_and_mixed_origin(self, client, monkeypatch) -> None:
        paper = _cache_paper(client, abstract=GOOD_ABSTRACT)

        manual = client.post(
            f"/papers/{paper['id']}/evidence-extractions",
            json={"population": "Adults", "confidence": "medium"},
        )
        assert manual.status_code == 201
        assert manual.json()["origin"] == "manual"
        assert manual.json()["model_name"] is None

        _patch_extraction_client(monkeypatch, lambda paper: dict(VALID_FIELDS))
        generated = client.post(f"/api/papers/{paper['id']}/extract")
        assert generated.status_code == 201

        evidence = client.get(f"/api/papers/{paper['id']}/evidence")
        assert evidence.status_code == 200
        rows = evidence.json()
        assert len(rows) == 2
        assert rows[0]["id"] == generated.json()["id"]  # newest first
        assert rows[0]["origin"] == "llm"
        assert rows[1]["origin"] == "manual"
