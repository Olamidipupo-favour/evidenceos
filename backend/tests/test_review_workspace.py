"""Tests for the evidence review workspace endpoints (Prompt 04).

Covers review CRUD, PMID-based paper attachment (including live fetch and its
failure modes), link notes/status updates, removal, and the evidence matrix.
"""

import httpx


def _make_review(client, title="Statins SR", question="Do statins reduce events?"):
    return client.post(
        "/api/reviews",
        json={"title": title, "research_question": question},
    )


def _cache_paper(client, pmid, title=None):
    return client.post(
        "/papers",
        json={"pmid": pmid, "title": title or f"Paper {pmid}"},
    ).json()


class TestReviewCrud:
    def test_full_crud_cycle(self, client) -> None:
        created = _make_review(client)
        assert created.status_code == 201
        review_id = created.json()["id"]

        get = client.get(f"/api/reviews/{review_id}")
        assert get.status_code == 200
        assert get.json()["research_question"] == "Do statins reduce events?"

        updated = client.patch(
            f"/api/reviews/{review_id}",
            json={"title": "Statins systematic review", "research_question": "Updated question"},
        )
        assert updated.status_code == 200
        assert updated.json()["title"] == "Statins systematic review"
        assert updated.json()["research_question"] == "Updated question"

        cleared = client.patch(
            f"/api/reviews/{review_id}",
            json={"research_question": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["research_question"] is None
        assert cleared.json()["title"] == "Statins systematic review"  # untouched

        deleted = client.delete(f"/api/reviews/{review_id}")
        assert deleted.status_code == 204
        assert client.get(f"/api/reviews/{review_id}").status_code == 404

    def test_patch_empty_title_rejected(self, client) -> None:
        review_id = _make_review(client).json()["id"]
        resp = client.patch(f"/api/reviews/{review_id}", json={"title": ""})
        assert resp.status_code == 422

    def test_patch_missing_review_returns_404(self, client) -> None:
        resp = client.patch(
            f"/api/reviews/{'00000000-0000-0000-0000-000000000000'}",
            json={"title": "nope"},
        )
        assert resp.status_code == 404

    def test_delete_missing_review_returns_404(self, client) -> None:
        resp = client.delete(f"/api/reviews/{'00000000-0000-0000-0000-000000000000'}")
        assert resp.status_code == 404


class TestAttachPaper:
    def test_attach_cached_paper_by_pmid(self, client) -> None:
        paper = _cache_paper(client, pmid=700)
        review_id = _make_review(client).json()["id"]

        resp = client.post(
            f"/api/reviews/{review_id}/papers",
            json={"pmid": 700, "notes": "found in screening"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["paper_id"] == paper["id"]
        assert body["status"] == "pending"
        assert body["notes"] == "found in screening"

    def test_attach_fetches_paper_from_pubmed(self, client, ncbi) -> None:
        review_id = _make_review(client).json()["id"]

        resp = client.post(
            f"/api/reviews/{review_id}/papers",
            json={"pmid": 38657777, "status": "included"},
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "included"
        assert ncbi.efetch_calls == 1

        paper = client.get("/api/papers/38657777").json()
        assert paper["title"].startswith("Once-weekly semaglutide")

    def test_attach_unknown_pmid_returns_404(self, client, ncbi) -> None:
        ncbi._articles = {}
        review_id = _make_review(client).json()["id"]
        resp = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 42424242})
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Paper not found in PubMed"

    def test_attach_pubmed_failure_returns_502(self, client, ncbi) -> None:
        ncbi._efetch_error = httpx.ConnectError("boom")
        review_id = _make_review(client).json()["id"]
        resp = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 42424242})
        assert resp.status_code == 502
        assert "PubMed API error" in resp.json()["detail"]

    def test_attach_duplicate_conflicts(self, client) -> None:
        _cache_paper(client, pmid=800)
        review_id = _make_review(client).json()["id"]
        payload = {"pmid": 800}
        assert client.post(f"/api/reviews/{review_id}/papers", json=payload).status_code == 201
        resp = client.post(f"/api/reviews/{review_id}/papers", json=payload)
        assert resp.status_code == 409

    def test_attach_zero_pmid_rejected(self, client) -> None:
        review_id = _make_review(client).json()["id"]
        resp = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 0})
        assert resp.status_code == 422


class TestNotesAndRemoval:
    def test_update_notes_and_status(self, client) -> None:
        _cache_paper(client, pmid=900)
        review_id = _make_review(client).json()["id"]
        link = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 900}).json()

        updated = client.patch(
            f"/api/reviews/{review_id}/papers/{link['paper_id']}",
            json={"status": "included", "notes": "primary RCT, keep"},
        )
        assert updated.status_code == 200
        assert updated.json()["status"] == "included"
        assert updated.json()["notes"] == "primary RCT, keep"

        notes_only = client.patch(
            f"/api/reviews/{review_id}/papers/{link['paper_id']}",
            json={"notes": "updated note"},
        )
        assert notes_only.json()["status"] == "included"  # untouched
        assert notes_only.json()["notes"] == "updated note"

    def test_update_invalid_status_rejected(self, client) -> None:
        _cache_paper(client, pmid=901)
        review_id = _make_review(client).json()["id"]
        link = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 901}).json()

        resp = client.patch(
            f"/api/reviews/{review_id}/papers/{link['paper_id']}",
            json={"status": "nonsense"},
        )
        assert resp.status_code == 422

    def test_remove_paper_then_verify(self, client) -> None:
        _cache_paper(client, pmid=902)
        _cache_paper(client, pmid=903)
        review_id = _make_review(client).json()["id"]
        client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 902})
        link = client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 903}).json()

        removed = client.delete(f"/api/reviews/{review_id}/papers/{link['paper_id']}")
        assert removed.status_code == 204

        remaining = client.get(f"/api/reviews/{review_id}/papers").json()
        assert len(remaining) == 1
        assert remaining[0]["paper_id"] != link["paper_id"]

        again = client.delete(f"/api/reviews/{review_id}/papers/{link['paper_id']}")
        assert again.status_code == 404


class TestMatrix:
    def test_matrix_with_five_papers_notes_and_evidence(self, client) -> None:
        review_id = _make_review(
            client, "Diabetes interventions", "Which interventions reduce HbA1c?"
        ).json()["id"]

        paper_ids = []
        for pmid in (100, 200, 300, 400, 500):
            paper = _cache_paper(client, pmid=pmid, title=f"Diabetes study {pmid}")
            paper_ids.append(paper["id"])

        client.post(
            f"/api/reviews/{review_id}/papers",
            json={"pmid": 100, "status": "included", "notes": "primary outcome"},
        )
        for pmid in (200, 300, 400, 500):
            client.post(f"/api/reviews/{review_id}/papers", json={"pmid": pmid})

        client.post(
            f"/papers/{paper_ids[0]}/evidence-extractions",
            json={
                "population": "Adults with T2DM",
                "intervention": "SGLT2 inhibitor",
                "outcome": "HbA1c",
                "sample_size": 1200,
                "confidence": "high",
            },
        )

        matrix = client.get(f"/api/reviews/{review_id}/matrix")
        assert matrix.status_code == 200
        body = matrix.json()
        assert body["total_papers"] == 5
        assert body["included_papers"] == 1
        assert body["review"]["title"] == "Diabetes interventions"
        assert body["review"]["research_question"] == "Which interventions reduce HbA1c?"

        pmids = [row["pmid"] for row in body["papers"]]
        assert sorted(pmids) == [100, 200, 300, 400, 500]

        first = body["papers"][0]
        assert first["status"] == "included"
        assert first["notes"] == "primary outcome"
        assert first["authors"] == []  # papers created without authors
        assert len(first["extractions"]) == 1
        assert first["extractions"][0]["population"] == "Adults with T2DM"
        assert first["extractions"][0]["confidence"] == "high"

        others = [row for row in body["papers"] if row["pmid"] != 100]
        assert all(row["status"] == "pending" and row["extractions"] == [] for row in others)

    def test_matrix_empty_review(self, client) -> None:
        review_id = _make_review(client).json()["id"]
        matrix = client.get(f"/api/reviews/{review_id}/matrix")
        assert matrix.status_code == 200
        assert matrix.json()["total_papers"] == 0
        assert matrix.json()["papers"] == []

    def test_matrix_unknown_review_returns_404(self, client) -> None:
        resp = client.get(f"/api/reviews/{'00000000-0000-0000-0000-000000000000'}/matrix")
        assert resp.status_code == 404

    def test_delete_review_cascades_links(self, client) -> None:
        _cache_paper(client, pmid=950)
        review_id = _make_review(client).json()["id"]
        client.post(f"/api/reviews/{review_id}/papers", json={"pmid": 950})

        assert client.delete(f"/api/reviews/{review_id}").status_code == 204
        assert client.get(f"/api/reviews/{review_id}").status_code == 404
