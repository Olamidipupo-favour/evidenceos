"""Opt-in live tests that hit the real NCBI E-utilities.

Run with ``RUN_LIVE_TESTS=1 uv run pytest -m live``. These prove the acceptance
criteria against real PubMed: a "diabetes" search returns normalized results and
a returned PMID resolves to structured paper information.
"""

import os

import pytest

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.environ.get("RUN_LIVE_TESTS"),
        reason="set RUN_LIVE_TESTS=1 to hit the real NCBI E-utilities",
    ),
]


def test_search_diabetes_returns_real_results(client) -> None:
    resp = client.get("/api/search", params={"q": "diabetes", "page": 1, "page_size": 5})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total"] > 0
    assert len(payload["items"]) > 0
    for item in payload["items"]:
        assert item["pmid"] > 0
        assert item["title"]


def test_get_paper_by_pmid_returns_structured_record(client) -> None:
    search = client.get("/api/search", params={"q": "diabetes", "page": 1, "page_size": 1})
    assert search.status_code == 200
    pmid = search.json()["items"][0]["pmid"]

    resp = client.get(f"/api/papers/{pmid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pmid"] == pmid
    assert body["title"]
    assert body["url"] == f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

    # Repeated lookups are served from the cache (no duplicate rows).
    again = client.get(f"/api/papers/{pmid}")
    assert again.status_code == 200
    assert again.json()["pmid"] == pmid
