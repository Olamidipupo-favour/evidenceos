"""Rate limiting middleware tests (Prompt 08)."""

from app.core.config import get_settings
from app.core.rate_limit import reset_rate_limits


def test_api_route_returns_429_after_limit(client, monkeypatch) -> None:
    reset_rate_limits()
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 3)

    for _ in range(3):
        response = client.get("/api/reviews")
        assert response.status_code == 200

    response = client.get("/api/reviews")
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    body = response.json()
    assert isinstance(body["detail"], str) and body["detail"]
    reset_rate_limits()


def test_health_and_non_api_routes_are_not_limited(client, monkeypatch) -> None:
    reset_rate_limits()
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 1)

    assert client.get("/health").status_code == 200
    assert client.get("/health").status_code == 200  # never 429
    reset_rate_limits()


def test_disabled_rate_limit_never_blocks(client, monkeypatch) -> None:
    reset_rate_limits()
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 0)

    for _ in range(5):
        response = client.get("/api/reviews")
        assert response.status_code == 200


def test_different_clients_have_independent_counters(client, monkeypatch) -> None:
    reset_rate_limits()
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 2)

    statuses = [
        client.get("/api/reviews", headers={"X-Forwarded-For": "10.0.0.1"}).status_code
        for _ in range(3)
    ]
    assert statuses == [200, 200, 429]

    # a different client is unaffected
    assert client.get("/api/reviews", headers={"X-Forwarded-For": "10.0.0.2"}).status_code == 200
    reset_rate_limits()
