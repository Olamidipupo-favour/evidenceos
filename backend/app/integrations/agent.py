"""Live planner for the WebMCP agent orchestrator.

The browser-side workflow no longer hardcodes a tool order. Instead an LLM
planner "thinks" each turn: it reasons aloud (streamed token by token to the
feed) and then emits a single machine-readable decision choosing which
EvidenceOS tool to call next, or that the goal is complete.

Transport: OpenAI-compatible ``/chat/completions`` with ``stream: true``. The
full reply is streamed back as ``thought`` tokens; the decision is parsed from
the final line of the reply (a compact JSON object), which keeps provider
compatibility broad — no native tool-calling support is required.

Safety: the planner is only ever offered the eight EvidenceOS tools, every
decision is validated (tool exists, arguments match the schema) by the
orchestrator before execution, failures are fed back into the transcript so the
model can adapt, and the stream is capped server-side by the provider timeout.

A deterministic ``MockAgentClient`` (``LLM_PROVIDER=mock``) powers local
development and tests without a key. It plans from the actual tool outputs in
the transcript rather than from a canned script, so it stays consistent with
whatever the orchestrator actually did.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Iterator
from typing import Any

import httpx

from app.core.config import get_settings
from app.schemas.agent import AgentDecision, AgentThinkRequest, AgentToolInfo


class AgentError(Exception):
    """Base class for planner failures."""


class AgentUnavailableError(AgentError):
    """No usable LLM provider is configured (maps to an error event)."""


class AgentProviderError(AgentError):
    """The LLM provider could not be reached or returned an error."""


class AgentResultError(AgentError):
    """The model produced no machine-readable decision."""


_SYSTEM_PROMPT = (
    "You are the planner agent for EvidenceOS, a tool that helps clinical researchers "
    "run systematic reviews. You decide which of the available tools to call next by "
    "reasoning about the goal; the tools execute against the real EvidenceOS backend and "
    "their outputs are appended to this conversation after each call.\n"
    "Rules:\n"
    "- Reason briefly and legibly before deciding. Your words are shown to the user live.\n"
    "- Prefer the active review named in the context and work inside it. If a review "
    "already exists, do NOT create a new one.\n"
    "- Call exactly ONE tool per turn, with arguments that satisfy that tool's JSON schema "
    "(the 'parameters' listed above).\n"
    "- If a tool call failed, read the error and adapt: fix the arguments, skip the step "
    "gracefully, or finish when the goal is otherwise met. Never repeat the same failed "
    "call with identical arguments.\n"
    "- Stop as soon as the scientific goal is satisfied (e.g. search the literature, fetch "
    "a paper, add it to the review, extract evidence, confirm the matrix, compare a second "
    "paper, then remove a redundant paper).\n"
    "Output format: after your reasoning, the FINAL line of your reply must be a single "
    "line containing ONLY one compact JSON object, with no markdown fences:\n"
    '{"done": false, "tool": "<tool name>", "arguments": { ... }}\n'
    'or, to finish: {"done": true, "summary": "one sentence describing what the workflow '
    'accomplished"}.\n'
)

_DONE_KEYS = {"summary"}
_DECISION_KEYS = {"done", "tool", "arguments", "summary"}
_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def build_think_messages(request: AgentThinkRequest) -> list[dict[str, Any]]:
    """Compose the chat payload for one planner turn."""
    system = request.messages.copy() and [{"role": "system", "content": _SYSTEM_PROMPT}]
    for message in request.messages:
        frame: dict[str, Any] = {"role": message.role, "content": message.content}
        if message.role == "tool" and message.tool_call_id:
            frame["tool_call_id"] = message.tool_call_id
        system.append(frame)

    tools_block = "\n".join(_format_tool(tool) for tool in request.tools)
    system.append(
        {
            "role": "user",
            "content": (
                f"Goal: {request.goal}\n\n"
                f"Context: {request.context}\n\n"
                f"Available tools:\n{tools_block}\n\n"
                "Reason briefly, then decide on the next tool call."
            ),
        }
    )
    return system


def _format_tool(tool: AgentToolInfo) -> str:
    read_only = "read-only" if tool.read_only else "mutating"
    schema = json.dumps(tool.parameters, sort_keys=True, separators=(",", ":"))
    return f"- {tool.name}: {tool.description} [{read_only}] schema={schema}"


def parse_decision(text: str, tool_names: set[str]) -> AgentDecision:
    """Extract the structured decision from the planner's reply.

    The planner is told to end with a bare single-line JSON object, but live
    models frequently deviate: they wrap the JSON in a markdown `````json`` `````
    fence, tack trailing prose after it, or bury it inside the reasoning text.
    Candidates are therefore tried in order:
    the last fenced code block, the whole reply when it is pure JSON, the last
    non-empty line that looks like an object, then any JSON object in the
    reply. The first candidate that parses to a well-formed decision wins.
    """
    raw = text.strip() or ""
    if not raw:
        raise AgentResultError(
            "The planner produced no machine-readable decision. Nothing was executed."
        )

    candidates: list[str] = []

    last_block: str | None = None
    for match in _FENCE_RE.finditer(raw):
        last_block = match.group(1).strip()
    if last_block:
        candidates.append(last_block)

    if raw.startswith("{") and raw.endswith("}"):
        candidates.append(raw)

    for line in reversed(raw.splitlines()):
        stripped = line.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            candidates.append(stripped)

    object_end = _OBJECT_RE.search(raw)
    if object_end:
        candidates.append(object_end.group(0))

    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue
        return _validate_decision(obj, tool_names)

    raise AgentResultError(
        "The planner produced no machine-readable decision. Nothing was executed."
    )


def _validate_decision(obj: dict[str, Any], tool_names: set[str]) -> AgentDecision:
    """Validate a parsed decision object against the contract."""
    known = set(obj).difference(_DECISION_KEYS)
    if known:
        raise AgentResultError(
            "The planner returned unexpected decision keys: " + ", ".join(sorted(known))
        )

    if obj.get("done"):
        summary = str(obj.get("summary")) if obj.get("summary") else None
        return AgentDecision(done=True, summary=summary)

    tool = obj.get("tool")
    if not isinstance(tool, str) or tool not in tool_names:
        raise AgentResultError(
            f'The planner chose an unknown tool: "{tool}". Nothing was executed.'
        )
    arguments = obj.get("arguments") or {}
    if not isinstance(arguments, dict):
        raise AgentResultError("The planner's tool arguments must be a JSON object.")
    return AgentDecision(done=False, tool=tool, arguments=arguments)


class LLMAgentClient:
    """Interface for the planner provider."""

    model: str = "unknown"

    def think(self, request: AgentThinkRequest) -> Iterator[tuple[str, Any]]:
        """Yield ``("thought", str)`` tokens then a final ``("decision", AgentDecision)``."""
        raise NotImplementedError


def _sse_line(line: str) -> str | None:
    line = line.strip()
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    return None if payload == "[DONE]" else payload


class OpenAICompatibleAgentClient(LLMAgentClient):
    """Streaming ``/chat/completions`` planner (OpenAI-compatible gateways)."""

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

    def think(self, request: AgentThinkRequest) -> Iterator[tuple[str, Any]]:
        tool_names = {tool.name for tool in request.tools}
        payload = {
            "model": self.model,
            "messages": build_think_messages(request),
            "temperature": 0.7,
            "max_tokens": 1024,
            "stream": True,
        }
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._user_agent:
            headers["User-Agent"] = self._user_agent

        buffer: list[str] = []
        try:
            with self._http.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code == 401:
                    raise AgentProviderError(
                        "LLM provider rejected the API key (check LLM_API_KEY)"
                    )
                if response.status_code == 429:
                    raise AgentProviderError("LLM provider rate limit reached; try again shortly")
                if response.status_code != 200:
                    detail = ""
                    try:
                        detail = response.read().decode("utf-8", errors="replace")[:200]
                    except Exception:  # defensive: body read must never break the stream
                        detail = ""
                    raise AgentProviderError(
                        f"LLM provider returned HTTP {response.status_code}"
                        + (f" — {detail}" if detail else "")
                    )

                for line in response.iter_lines():
                    if not line:
                        continue
                    payload = _sse_line(line)
                    if payload is None:
                        continue
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    try:
                        delta = event["choices"][0]["delta"]
                    except KeyError, IndexError, TypeError:
                        continue
                    token = delta.get("content")
                    if token:
                        buffer.append(token)
                        yield ("thought", token)
        except httpx.RequestError as exc:
            raise AgentProviderError(f"could not reach the LLM provider: {exc}") from exc

        decision = parse_decision("".join(buffer), tool_names)
        yield ("decision", decision)


class MockAgentClient(LLMAgentClient):
    """Deterministic developer seam for ``LLM_PROVIDER=mock``.

    Plans from the actual tool outputs recorded in the transcript (parsed from
    the tool messages), so a mock run stays consistent with what the
    orchestrator really did: search → fetch → (create if needed) → add →
    extract → matrix → compare → clean up → done. It reacts to failures by
    skipping the broken step or finishing gracefully, and always terminates.
    Never selectable in production.
    """

    model = "mock:dev"

    def think(self, request: AgentThinkRequest) -> Iterator[tuple[str, Any]]:
        history = _mock_history(request)
        for token in _mock_reasoning(history):
            time.sleep(0.012)  # visible streaming cadence, like a real model
            yield ("thought", token)
        decision = _mock_decision(request, history)
        time.sleep(0.012)
        yield ("decision", decision)


def _mock_history(request: AgentThinkRequest) -> dict[str, Any]:
    """Snapshot of successful tool outputs + failed attempts from the transcript."""
    history: dict[str, Any] = {"ok": {}, "failed": set(), "adds": 0}
    for message in request.messages:
        if message.role != "tool" or not message.tool_call_id:
            continue
        name = message.tool_call_id
        payload = message.content.strip()
        failed = payload.startswith("{") and '"ok": false' in payload
        if failed:
            history["failed"].add(name)
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            history["failed"].add(name)
            continue
        if name == "add_paper_to_review":
            history["adds"] += 1
        history["ok"][name] = data
    return history


def _question_from_request(request: AgentThinkRequest) -> str:
    match = re.search(r"Research question:\s*([^\n]*?)(?:\.\s*Active review|\s*$)", request.context)
    if match and match.group(1).strip():
        return match.group(1).strip()
    return "metformin type 2 diabetes"


def _active_review_id(request: AgentThinkRequest) -> str | None:
    match = re.search(r"id:\s*([0-9a-fA-F-]{36})", request.context)
    return match.group(1) if match else None


def _mock_papers(history: dict[str, Any]) -> list[int]:
    search = history["ok"].get("search_literature")
    if not isinstance(search, dict):
        return []
    items = search.get("items") or search.get("papers")
    if not isinstance(items, list):
        return []
    pmids = [item.get("pmid") for item in items if isinstance(item, dict)]
    return [int(p) for p in pmids if isinstance(p, (int, str)) and str(p).isdigit()]


def _mock_review_id(request: AgentThinkRequest, history: dict[str, Any]) -> str | None:
    created = history["ok"].get("create_review")
    if isinstance(created, dict) and isinstance(created.get("review"), dict):
        review = created["review"].get("id")
        if review:
            return str(review)
    return _active_review_id(request)


def _mock_reasoning(history: dict[str, Any]) -> list[str]:
    ok = history["ok"]
    if "search_literature" not in ok:
        return [
            "The workspace is empty, so I should start by finding primary studies on PubMed.",
            "I will search with the research question to pull real candidates.",
        ]
    if "get_paper" not in ok:
        return [
            "The search returned candidates. Let me inspect the strongest hit in detail.",
        ]
    if "add_paper_to_review" not in ok:
        return [
            "There is no review to file this work under, so I will create one first.",
        ]
    return [
        "The evidence is in place. I will confirm the matrix reflects it, exercise a "
        "comparison, and clean up the redundant paper before finishing.",
    ]


def _mock_decision(request: AgentThinkRequest, history: dict[str, Any]) -> AgentDecision:
    ok = history["ok"]
    failed = history["failed"]
    papers = _mock_papers(history)
    primary = papers[0] if papers else None
    secondary = papers[1] if len(papers) > 1 else None
    question = _question_from_request(request)
    review_id = _mock_review_id(request, history)
    add_ok = history["adds"]
    last_add = ok.get("add_paper_to_review")

    if primary is None and "get_paper" in failed:
        return AgentDecision(
            done=True,
            summary="The planner could not fetch usable studies for the research question.",
        )

    if "search_literature" not in ok:
        return AgentDecision(
            tool="search_literature",
            arguments={"query": question, "page_size": 6},
        )
    if "get_paper" not in ok:
        if primary is None:
            return AgentDecision(
                done=True,
                summary="The search returned no usable studies, so the run stopped early.",
            )
        return AgentDecision(tool="get_paper", arguments={"reference": primary})
    if not review_id:
        if "create_review" in failed:
            return AgentDecision(
                done=True, summary="A review could not be created, so the run was stopped."
            )
        return AgentDecision(
            tool="create_review",
            arguments={"title": "WebMCP demonstration", "research_question": question},
        )
    if add_ok == 0:
        return AgentDecision(
            tool="add_paper_to_review",
            arguments={"review_id": review_id, "pmid": primary, "status": "included"},
        )
    if "extract_evidence" not in ok and "extract_evidence" not in failed:
        return AgentDecision(tool="extract_evidence", arguments={"reference": primary})
    if secondary and add_ok == 1:
        return AgentDecision(
            tool="add_paper_to_review",
            arguments={"review_id": review_id, "pmid": secondary, "status": "included"},
        )
    if "get_evidence_matrix" not in ok:
        return AgentDecision(tool="get_evidence_matrix", arguments={"review_id": review_id})
    if secondary and "compare_papers" not in ok and "compare_papers" not in failed:
        return AgentDecision(tool="compare_papers", arguments={"references": [primary, secondary]})
    if secondary and "remove_paper_from_review" not in ok and isinstance(last_add, dict):
        paper_id = last_add.get("paper_id")
        if not isinstance(paper_id, str):
            paper = last_add.get("paper")
            if isinstance(paper, dict):
                paper_id = paper.get("paper_id")
        if isinstance(paper_id, str):
            return AgentDecision(
                tool="remove_paper_from_review",
                arguments={"review_id": review_id, "paper_id": paper_id},
            )
    return AgentDecision(
        done=True,
        summary="Completed an end-to-end evidence run: chose studies, added evidence to the "
        "review, confirmed the matrix, compared papers and cleaned up.",
    )


def get_agent_client() -> LLMAgentClient:
    """Return a module-level planner client based on settings (seam mirrors extraction)."""
    settings = get_settings()
    if settings.llm_provider == "mock":
        if settings.app_env == "production":
            raise AgentUnavailableError("mock planning is not allowed in production")
        return MockAgentClient()
    if not settings.llm_api_key:
        raise AgentUnavailableError(
            "The planner is not configured -- set LLM_API_KEY (and LLM_PROVIDER) in "
            "backend/.env to let the agent think and choose tools."
        )
    return OpenAICompatibleAgentClient(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        timeout=settings.llm_timeout,
        user_agent=settings.llm_user_agent,
    )
