"""Schemas for the live agent orchestrator (the "think" loop behind WebMCP).

The frontend drives an LLM planner that reasons aloud and then picks exactly one
EvidenceOS tool per turn. Each turn is an SSE stream: incremental ``thought``
tokens followed by a structured ``decision`` (a tool call, or "done").
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentToolInfo(BaseModel):
    """The tool surface exposed to the planner (mirrors the WebMCP contract)."""

    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    parameters: dict[str, Any] = Field(default_factory=dict)
    read_only: bool = False


class AgentMessage(BaseModel):
    """One turn of the planner's own working transcript.

    ``tool`` messages carry the output the orchestrator received for the last
    tool call, tagged with the tool name that produced it.
    """

    role: Literal["assistant", "tool"]
    content: str = Field(min_length=1, max_length=16000)
    tool_call_id: str | None = None


class AgentThinkRequest(BaseModel):
    """Request body for one planner turn."""

    goal: str = Field(min_length=1, max_length=4000)
    context: str = Field(min_length=1, max_length=8000)
    tools: list[AgentToolInfo] = Field(min_length=1, max_length=64)
    messages: list[AgentMessage] = Field(default_factory=list)


class AgentDecision(BaseModel):
    """A structured next-step choice (the final line of the model's reply)."""

    done: bool = False
    tool: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    summary: str | None = None
