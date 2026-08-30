"""LLM-powered structured evidence extraction (Prompt 06).

Provider-agnostic (OpenAI-compatible chat completions by default). The agent is
used ONLY to structure information already present in the paper's title and
abstract -- it never adds external clinical knowledge. Every generated result is
re-validated against the ``EvidenceExtractionCreate`` Pydantic schema by the
route before anything can be persisted, so malformed or fabricated-looking
output is rejected outright and no database row is created.

Pipeline::

    paper (DB) -> prompt -> LLM -> JSON -> Pydantic validation -> DB row

Failed or unconfigured providers raise typed errors that map to clean HTTP
responses; nothing is written on any failure path.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import httpx

from app.core.config import get_settings

if TYPE_CHECKING:
    from app.models.paper import Paper


class ExtractionError(Exception):
    """Base class for evidence extraction failures."""


class ExtractionUnavailableError(ExtractionError):
    """No usable LLM provider is configured (maps to HTTP 503)."""


class ExtractionProviderError(ExtractionError):
    """The LLM provider could not be reached or returned an error (HTTP 502)."""


class ExtractionResultError(ExtractionError):
    """The model returned output that could not be used (HTTP 422)."""


EXTRACTION_FIELDS = (
    "population",
    "intervention",
    "comparison",
    "outcome",
    "study_design",
    "sample_size",
    "key_finding",
    "limitations",
    "confidence",
)

_SYSTEM_PROMPT = (
    "You are an evidence-extraction assistant helping clinical researchers build a "
    "systematic review. Extract the requested fields from the article title and abstract "
    "ONLY. Do not use prior knowledge and do not infer beyond the text. Never fabricate "
    "effect sizes, sample sizes, outcomes, population details, or study designs. When the "
    "text does not report a field, set it to null rather than guessing. Return STRICT JSON "
    "only, with exactly these keys: population, intervention, comparison, outcome, "
    "study_design, sample_size, key_finding, limitations, confidence. sample_size must be "
    "an integer or null. confidence must be one of 'low', 'medium', 'high' or null, and "
    "reflects how directly the full abstract supports the extracted fields."
)


def build_extraction_messages(paper: Paper) -> list[dict[str, str]]:
    """Compose the extraction prompt from the paper's stored metadata."""
    lines = [f"Title: {paper.title}"]
    if paper.journal:
        lines.append(f"Journal: {paper.journal}")
    if paper.publication_date:
        lines.append(f"Publication date: {paper.publication_date.isoformat()}")
    abstract = (paper.abstract or "").strip()
    if abstract:
        lines.append("")
        lines.append("Abstract:")
        lines.append(abstract)
    else:
        lines.append("")
        lines.append("Abstract: (not available)")
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(lines)},
    ]


class LLMClient:
    """Interface for extraction providers."""

    model: str = "unknown"

    def extract(self, paper: Paper) -> dict[str, Any]:
        """Return raw structured fields for the paper (unvalidated)."""
        raise NotImplementedError


class OpenAICompatibleClient(LLMClient):
    """OpenAI-compatible ``/chat/completions`` client running in JSON mode."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout: float,
        user_agent: str | None = None,
        http: httpx.Client | None = None,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._user_agent = user_agent
        self._http = http or httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._http.close()

    def extract(self, paper: Paper) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": build_extraction_messages(paper),
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._user_agent:
            headers["User-Agent"] = self._user_agent
        try:
            response = self._http.post(
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
        except httpx.RequestError as exc:
            raise ExtractionProviderError(f"could not reach the LLM provider: {exc}") from exc

        if response.status_code == 401:
            raise ExtractionProviderError("LLM provider rejected the API key (check LLM_API_KEY)")
        if response.status_code == 429:
            raise ExtractionProviderError("LLM provider rate limit reached; try again shortly")
        if response.status_code != 200:
            raise ExtractionProviderError(f"LLM provider returned HTTP {response.status_code}")

        try:
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
            raise ExtractionResultError(
                "The model did not return valid JSON; nothing was saved"
            ) from exc
        if not isinstance(parsed, dict):
            raise ExtractionResultError("The model did not return a JSON object; nothing was saved")
        return parsed


class MockExtractionClient(LLMClient):
    """Deterministic developer seam for local demos and tests.

    Returns canned, clearly-labelled values and never derives new facts from the
    abstract. It is only selectable via ``LLM_PROVIDER=mock`` and is refused in
    production environments.
    """

    model = "mock:dev"

    def extract(self, paper: Paper) -> dict[str, Any]:
        return {
            "population": "Adults with type 2 diabetes",
            "intervention": "SGLT2 inhibitor",
            "comparison": "Placebo or standard care",
            "outcome": "Major adverse cardiovascular events",
            "study_design": "Randomized controlled trial",
            "sample_size": 4744,
            "key_finding": "Not reported (mock)",  # clearly labelled dev output
            "limitations": None,
            "confidence": "low",
        }


def get_extraction_client() -> LLMClient:
    """Return a module-level extraction client based on settings.

    Mock mode is a developer seam and is refused in production; without an API
    key the OpenAI-compatible provider raises ``ExtractionUnavailableError`` so
    the endpoint degrades cleanly to HTTP 503 (manual entry remains available).
    """
    settings = get_settings()
    if settings.llm_provider == "mock":
        if settings.app_env == "production":
            raise ExtractionUnavailableError("mock extraction is not allowed in production")
        return MockExtractionClient()
    if not settings.llm_api_key:
        raise ExtractionUnavailableError(
            "LLM extraction is not configured -- set LLM_API_KEY (and LLM_PROVIDER) in "
            "backend/.env, or record evidence manually."
        )
    return OpenAICompatibleClient(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        timeout=settings.llm_timeout,
        user_agent=settings.llm_user_agent,
    )
