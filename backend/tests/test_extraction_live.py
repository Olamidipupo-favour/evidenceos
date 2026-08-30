"""Opt-in live test for LLM-powered evidence extraction.

Requires ``RUN_LIVE_TESTS=1`` and a configured LLM provider
(``LLM_API_KEY``; see ``backend/.env.example``). Proves the acceptance
criteria end-to-end: a real paper from PubMed is transformed into structured
evidence and the extraction is visible through the evidence endpoint.
"""

import os

import pytest

from app.core.config import get_settings

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.environ.get("RUN_LIVE_TESTS"),
        reason="set RUN_LIVE_TESTS=1 to run live integration tests",
    ),
    pytest.mark.skipif(
        not (os.environ.get("LLM_API_KEY") or get_settings().llm_api_key),
        reason="set LLM_API_KEY to exercise the real extraction provider",
    ),
]


def test_real_paper_extracts_structured_json(client) -> None:
    search = client.get(
        "/api/search",
        params={"q": "semaglutide obesity randomized trial", "page": 1, "page_size": 1},
    )
    assert search.status_code == 200
    pmid = search.json()["items"][0]["pmid"]
    assert pmid

    resp = client.post(f"/api/papers/{pmid}/extract")
    assert resp.status_code == 201, resp.text
    body = resp.json()

    assert body["origin"] == "llm"
    assert body["model_name"]
    for field in (
        "population",
        "intervention",
        "comparison",
        "outcome",
        "study_design",
        "sample_size",
        "key_finding",
        "limitations",
        "confidence",
    ):
        assert field in body

    evidence = client.get(f"/api/papers/{pmid}/evidence")
    assert evidence.status_code == 200
    assert any(row["id"] == body["id"] for row in evidence.json())
