"""Routes for the live agent orchestrator powering the WebMCP demo.

``POST /api/agent/think`` streams a planner decision as ``text/event-stream``:
incremental ``thought`` tokens (shown verbatim in the Agent Actions feed) then a
final ``decision`` event (a tool call, or "done"). Provider problems are
surfaced as an ``error`` event so the orchestrator can fall back gracefully
instead of hanging the browser on an aborted connection.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.integrations import agent as planner
from app.integrations.agent import AgentError
from app.schemas.agent import AgentThinkRequest

router = APIRouter(prefix="/api/agent", tags=["agent"])


def _sse(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"


@router.post("/think")
def agent_think(request: AgentThinkRequest) -> StreamingResponse:
    """Run one "think" turn: stream reasoning, then the structured decision."""

    def stream() -> Iterator[str]:
        try:
            client = planner.get_agent_client()
        except AgentError as exc:
            yield _sse({"type": "error", "message": str(exc)})
            return

        try:
            for kind, payload in client.think(request):
                if kind == "thought":
                    yield _sse({"type": "thought", "text": payload})
                else:
                    yield _sse({"type": "decision", "decision": payload.model_dump()})
        except AgentError as exc:
            yield _sse({"type": "error", "message": str(exc)})
        except Exception:  # defensive: a planner bug must never break the stream
            yield _sse({"type": "error", "message": "The planner could not produce a decision."})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
