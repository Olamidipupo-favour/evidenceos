"""Tests for the agent orchestrator "think" endpoint and planner.

The endpoint streams SSE events -- ``thought`` tokens then a structured
``decision`` -- and degrades to ``error`` events (never a hung connection) when
the provider is unavailable or fails. Providers are stubbed so no real network
call is made; the deterministic ``MockAgentClient`` is exercised directly to
prove that decisions are driven by the transcript's actual tool outputs.
"""

import pytest
from fastapi.testclient import TestClient

from app.integrations.agent import (
    AgentDecision,
    AgentProviderError,
    AgentUnavailableError,
    MockAgentClient,
    build_think_messages,
    parse_decision,
)
from app.main import app
from app.schemas.agent import AgentMessage, AgentThinkRequest, AgentToolInfo

client = TestClient(app)


def _request(**overrides) -> dict:
    body = {
        "goal": "Build a systematic review.",
        "context": "Research question: metformin type 2 diabetes",
        "tools": [
            {
                "name": "search_literature",
                "description": "Search PubMed.",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
                "read_only": True,
            }
        ],
        "messages": [],
    }
    body.update(overrides)
    return body


class FakeStreamer:
    def __init__(self, events):
        self._events = events

    def think(self, request):
        yield from self._events


def _patch_planner(monkeypatch, events):
    monkeypatch.setattr(
        "app.integrations.agent.get_agent_client",
        lambda: FakeStreamer(events),
    )


def test_streams_thoughts_then_a_tool_decision(monkeypatch) -> None:
    _patch_planner(
        monkeypatch,
        [
            ("thought", "I need to find primary studies first."),
            ("thought", " Searching PubMed now."),
            (
                "decision",
                AgentDecision(tool="search_literature", arguments={"query": "metformin"}),
            ),
        ],
    )

    resp = client.post("/api/agent/think", json=_request())
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    body = resp.text
    assert 'data: {"type":"thought","text":"I need to find primary studies first."}' in body
    assert 'data: {"type":"thought","text":" Searching PubMed now."}' in body
    assert (
        'data: {"type":"decision","decision":{"done":false,"tool":"search_literature",'
        '"arguments":{"query":"metformin"},"summary":null}}' in body
    )


def test_streams_a_done_decision(monkeypatch) -> None:
    _patch_planner(
        monkeypatch,
        [
            ("thought", "Goal satisfied."),
            ("decision", AgentDecision(done=True, summary="Review filled and verified.")),
        ],
    )

    resp = client.post("/api/agent/think", json=_request())
    assert resp.status_code == 200
    assert '"type":"decision"' in resp.text
    assert '"done":true' in resp.text
    assert '"summary":"Review filled and verified."' in resp.text


def test_unconfigured_planner_emits_an_error_event(monkeypatch) -> None:
    def _raise():
        raise AgentUnavailableError("The planner is not configured")

    monkeypatch.setattr("app.integrations.agent.get_agent_client", _raise)

    resp = client.post("/api/agent/think", json=_request())
    assert resp.status_code == 200  # the stream itself never fails
    assert '"type":"error"' in resp.text
    assert "not configured" in resp.text
    assert '"type":"decision"' not in resp.text


def test_provider_failure_mid_stream_emits_an_error_event(monkeypatch) -> None:
    class MidStreamFailure:
        def think(self, request):
            yield ("thought", "first thought arrives fine")
            raise AgentProviderError("could not reach the LLM provider")

    monkeypatch.setattr("app.integrations.agent.get_agent_client", lambda: MidStreamFailure())

    resp = client.post("/api/agent/think", json=_request())
    assert resp.status_code == 200
    assert '"type":"thought"' in resp.text
    assert '"type":"error"' in resp.text
    assert "could not reach the LLM provider" in resp.text


def test_missing_tools_are_rejected(monkeypatch) -> None:
    _patch_planner(monkeypatch, [])
    resp = client.post("/api/agent/think", json=_request(tools=[]))
    assert resp.status_code == 422


class TestDecisionParser:
    def test_extracts_decision_from_the_final_line(self) -> None:
        text = (
            "The review has no papers yet.\n"
            '{"done": false, "tool": "search_literature", "arguments": {"query": "x"}}'
        )
        decision = parse_decision(text, {"search_literature"})
        assert decision.done is False
        assert decision.tool == "search_literature"
        assert decision.arguments == {"query": "x"}

    def test_rejects_unknown_tools(self) -> None:
        with pytest.raises(Exception, match="unknown tool"):
            parse_decision('{"done": false, "tool": "rm -rf"}', {"search_literature"})

    def test_rejects_missing_decision_line(self) -> None:
        with pytest.raises(Exception, match="no machine-readable decision"):
            parse_decision("Reasoned but never decided.", {"search_literature"})

    def test_rejects_extra_decision_keys(self) -> None:
        with pytest.raises(Exception, match="unexpected decision keys"):
            parse_decision('{"done": false, "tool": "x", "banana": 1}', {"x"})


class TestMessageBuilding:
    def test_appends_goal_context_and_tools(self) -> None:
        incoming = AgentMessage(role="assistant", content="Previous decision")
        messages = build_think_messages(
            AgentThinkRequest(
                goal="G",
                context="C",
                tools=[AgentToolInfo(name="search_literature", description="S")],
                messages=[incoming],
            )
        )
        assert messages[0]["role"] == "system"
        assert {"role": "assistant", "content": "Previous decision"} in messages
        last = messages[-1]
        assert last["role"] == "user"
        assert "Goal: G" in last["content"]
        assert "Context: C" in last["content"]
        assert "search_literature: S" in last["content"]


class TestMockPlanner:
    def _tools(self):
        names = [
            "search_literature",
            "get_paper",
            "create_review",
            "add_paper_to_review",
            "remove_paper_from_review",
            "extract_evidence",
            "get_evidence_matrix",
            "compare_papers",
        ]
        return [AgentToolInfo(name=name, description=name) for name in names]

    def _request(self, context: str, messages: list[AgentMessage]) -> AgentThinkRequest:
        return AgentThinkRequest(
            goal="Build a systematic review.",
            context=context,
            tools=self._tools(),
            messages=messages,
        )

    SEARCH_OUTPUT = (
        '{"query": "q", "page": 1, "page_size": 6, "total": 2, '
        '"items": [{"pmid": 174596}, {"pmid": 74576}]}'
    )
    REVIEW_ID = "3f8c1c02-1d0a-4d2e-9b42-6b7c9d0b1a2c"

    def test_decides_step_by_step_from_transcript_outputs(self) -> None:
        context = (
            f"Research question: metformin type 2 diabetes. Active review: Metformin "
            f"(id: {self.REVIEW_ID})."
        )
        plan = MockAgentClient()

        # 1: nothing done yet → search with the research question.
        decision = list(plan.think(self._request(context, [])))[-1][1]
        assert decision.tool == "search_literature"
        assert decision.arguments["query"] == "metformin type 2 diabetes"

        def search_turn() -> AgentDecision:
            messages = [
                AgentMessage(
                    role="tool", content=self.SEARCH_OUTPUT, tool_call_id="search_literature"
                )
            ]
            return list(plan.think(self._request(context, messages)))[-1][1]

        # 2: papers found → inspect the top hit.
        decision = search_turn()
        assert decision.tool == "get_paper"
        assert decision.arguments["reference"] == 174596

        # 3: with an active review present, it works inside it (no create_review).
        messages = [
            AgentMessage(role="tool", content=self.SEARCH_OUTPUT, tool_call_id="search_literature"),
            AgentMessage(role="tool", content='{"pmid": 174596}', tool_call_id="get_paper"),
        ]
        decision = list(plan.think(self._request(context, messages)))[-1][1]
        assert decision.tool == "add_paper_to_review"
        assert decision.arguments["review_id"] == self.REVIEW_ID
        assert decision.arguments["pmid"] == 174596

    def test_creates_a_review_only_when_none_exists(self) -> None:
        context = "Research question: metformin type 2 diabetes"
        plan = MockAgentClient()
        messages = [
            AgentMessage(role="tool", content=self.SEARCH_OUTPUT, tool_call_id="search_literature"),
            AgentMessage(role="tool", content='{"pmid": 174596}', tool_call_id="get_paper"),
        ]
        decision = list(plan.think(self._request(context, messages)))[-1][1]
        assert decision.tool == "create_review"
        assert decision.arguments["research_question"] == "metformin type 2 diabetes"

    def test_finishes_after_cleanup(self) -> None:
        context = (
            f"Research question: metformin type 2 diabetes. Active review: Metformin "
            f"(id: {self.REVIEW_ID})."
        )
        plan = MockAgentClient()
        messages = [
            AgentMessage(role="tool", content=self.SEARCH_OUTPUT, tool_call_id="search_literature"),
            AgentMessage(role="tool", content='{"pmid": 174596}', tool_call_id="get_paper"),
            AgentMessage(
                role="tool",
                content=f'{{"review_id": "{self.REVIEW_ID}", "pmid": 174596, "paper_id": "pap-1"}}',
                tool_call_id="add_paper_to_review",
            ),
            AgentMessage(
                role="tool",
                content='{"key_finding": "Reduced HbA1c"}',
                tool_call_id="extract_evidence",
            ),
            AgentMessage(
                role="tool",
                content=f'{{"review_id": "{self.REVIEW_ID}", "pmid": 74576, "paper_id": "pap-2"}}',
                tool_call_id="add_paper_to_review",
            ),
            AgentMessage(
                role="tool",
                content=f'{{"review_id": "{self.REVIEW_ID}", "papers": []}}',
                tool_call_id="get_evidence_matrix",
            ),
            AgentMessage(
                role="tool",
                content='{"comparison": "differ"}',
                tool_call_id="compare_papers",
            ),
            AgentMessage(
                role="tool",
                content=f'{{"review_id": "{self.REVIEW_ID}", "paper_id": "pap-2"}}',
                tool_call_id="remove_paper_from_review",
            ),
        ]
        decision = list(plan.think(self._request(context, messages)))[-1][1]
        assert decision.done is True
        assert "end-to-end" in (decision.summary or "")
        # The primary paper is never removed: it stays in the matrix.
        cleanup = [m for m in messages if m.tool_call_id == "remove_paper_from_review"]
        assert cleanup[-1].content == f'{{"review_id": "{self.REVIEW_ID}", "paper_id": "pap-2"}}'
