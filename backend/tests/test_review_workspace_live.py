"""Opt-in live acceptance test for the review workspace.

Run with ``RUN_LIVE_TESTS=1 uv run pytest -m live``. Proves the Prompt 04
acceptance criterion end-to-end against real PubMed: create a review, search,
add five papers, retrieve the review, and see all five papers in the matrix.
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


def test_review_search_add_five_and_matrix(client) -> None:
    created = client.post(
        "/api/reviews",
        json={
            "title": "Diabetes interventions review",
            "research_question": "Which interventions reduce HbA1c in type 2 diabetes?",
        },
    )
    assert created.status_code == 201
    review_id = created.json()["id"]

    search = client.get("/api/search", params={"q": "diabetes", "page_size": 5})
    assert search.status_code == 200
    pmids = [item["pmid"] for item in search.json()["items"]]
    assert len(pmids) == 5

    for pmid in pmids:
        attached = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": pmid})
        assert attached.status_code == 201, attached.text

    review = client.get(f"/api/reviews/{review_id}")
    assert review.status_code == 200
    assert review.json()["title"] == "Diabetes interventions review"

    matrix = client.get(f"/api/reviews/{review_id}/matrix")
    assert matrix.status_code == 200
    body = matrix.json()
    assert body["total_papers"] == 5
    assert sorted(row["pmid"] for row in body["papers"]) == sorted(pmids)
    for row in body["papers"]:
        assert row["title"]
