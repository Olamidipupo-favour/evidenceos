"""API tests: happy paths and useful validation errors."""

import uuid


def _create_review(client, title="Review title", research_question=None):
    return client.post(
        "/reviews",
        json={"title": title, "research_question": research_question},
    )


def _create_paper(client, pmid=1000, title="Paper title"):
    return client.post(
        "/papers",
        json={"pmid": pmid, "title": title},
    )


class TestReviews:
    def test_create_review(self, client) -> None:
        response = _create_review(
            client, "SR of statins", "Do statins reduce cardiovascular events?"
        )
        assert response.status_code == 201
        body = response.json()
        assert body["title"] == "SR of statins"
        assert body["research_question"] == "Do statins reduce cardiovascular events?"
        assert uuid.UUID(body["id"])
        assert body["created_at"]

    def test_create_review_empty_title_is_rejected(self, client) -> None:
        response = _create_review(client, title="")
        assert response.status_code == 422
        assert "title" in response.text

    def test_review_not_found(self, client) -> None:
        response = client.get(f"/reviews/{uuid.uuid4()}")
        assert response.status_code == 404
        assert response.json()["detail"] == "Review not found"


class TestPapers:
    def test_create_paper(self, client) -> None:
        response = _create_paper(client, pmid=38657777, title="A trial")
        assert response.status_code == 201
        body = response.json()
        assert body["pmid"] == 38657777
        assert body["title"] == "A trial"
        assert uuid.UUID(body["id"])

    def test_create_paper_requires_pmid(self, client) -> None:
        response = client.post("/papers", json={"title": "no pmid"})
        assert response.status_code == 422
        assert "pmid" in response.text

    def test_create_paper_nonpositive_pmid_is_rejected(self, client) -> None:
        response = client.post("/papers", json={"pmid": -1, "title": "negative"})
        assert response.status_code == 422

    def test_create_paper_duplicate_pmid_conflicts(self, client) -> None:
        assert _create_paper(client, pmid=100).status_code == 201
        response = _create_paper(client, pmid=100, title="duplicate")
        assert response.status_code == 409
        assert "PMID" in response.json()["detail"]

    def test_paper_not_found(self, client) -> None:
        response = client.get(f"/papers/{uuid.uuid4()}")
        assert response.status_code == 404
        assert response.json()["detail"] == "Paper not found"


class TestReviewPaperLink:
    def test_attach_paper_to_review_and_list(self, client) -> None:
        review = _create_review(client).json()
        paper = _create_paper(client).json()

        response = client.post(
            f"/reviews/{review['id']}/papers",
            json={"paper_id": paper["id"], "status": "included", "notes": "kept"},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "included"
        assert body["paper_id"] == paper["id"]

        listed = client.get(f"/reviews/{review['id']}/papers")
        assert listed.status_code == 200
        assert [row["paper_id"] for row in listed.json()] == [paper["id"]]

    def test_attach_invalid_status_is_rejected(self, client) -> None:
        review = _create_review(client).json()
        paper = _create_paper(client).json()

        response = client.post(
            f"/reviews/{review['id']}/papers",
            json={"paper_id": paper["id"], "status": "maybe"},
        )
        assert response.status_code == 422
        assert "status" in response.text

    def test_attach_unknown_paper_returns_404(self, client) -> None:
        review = _create_review(client).json()
        response = client.post(
            f"/reviews/{review['id']}/papers",
            json={"paper_id": str(uuid.uuid4())},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Paper not found"

    def test_attach_unknown_review_returns_404(self, client) -> None:
        paper = _create_paper(client).json()
        response = client.post(
            f"/reviews/{uuid.uuid4()}/papers",
            json={"paper_id": paper["id"]},
        )
        assert response.status_code == 404
        assert response.json()["detail"] == "Review not found"

    def test_attach_duplicate_link_conflicts(self, client) -> None:
        review = _create_review(client).json()
        paper = _create_paper(client).json()
        payload = {"paper_id": paper["id"], "status": "pending"}

        assert client.post(f"/reviews/{review['id']}/papers", json=payload).status_code == 201
        response = client.post(f"/reviews/{review['id']}/papers", json=payload)
        assert response.status_code == 409


class TestEvidenceExtractions:
    def test_create_evidence_extraction(self, client) -> None:
        paper = _create_paper(client).json()
        response = client.post(
            f"/papers/{paper['id']}/evidence-extractions",
            json={
                "population": "Adults",
                "outcome": "Mortality",
                "sample_size": 500,
                "confidence": "medium",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["sample_size"] == 500
        assert body["confidence"] == "medium"
        assert body["paper_id"] == paper["id"]
        assert uuid.UUID(body["id"])

    def test_negative_sample_size_is_rejected(self, client) -> None:
        paper = _create_paper(client).json()
        response = client.post(
            f"/papers/{paper['id']}/evidence-extractions",
            json={"sample_size": -5},
        )
        assert response.status_code == 422

    def test_invalid_confidence_is_rejected(self, client) -> None:
        paper = _create_paper(client).json()
        response = client.post(
            f"/papers/{paper['id']}/evidence-extractions",
            json={"confidence": "certain"},
        )
        assert response.status_code == 422
        assert "confidence" in response.text

    def test_extraction_for_unknown_paper_returns_404(self, client) -> None:
        response = client.post(
            f"/papers/{uuid.uuid4()}/evidence-extractions",
            json={"outcome": "Mortality"},
        )
        assert response.status_code == 404
