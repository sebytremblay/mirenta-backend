"""Worked example tools — reference implementations, not production wiring.

Every tool here is tagged ``"example"`` so it never leaks into a real channel's
tool set by accident: production binders pass an explicit ``tags`` filter (or a
channel filter that these opt out of). Delete or copy from this file when the
first real tool lands.

Two shapes are demonstrated:

- ``lookup_org_knowledge`` — a **read-only** tool (``durable=False``). It calls
  ``app/services`` domain logic directly and returns the result inline, which
  is safe on a live voice turn because it has no side effect.
- ``request_meeting`` — a **durable** tool (``durable=True``). It does NOT book
  anything inline; it routes a signal into the contact's ``ContactLoopWorkflow``
  via ``temporal_bridge`` and returns an acknowledgement, so the decision engine
  owns the actual outreach/scheduling effect.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.agent_tools.context import ToolContext
from app.agent_tools.registry import register
from app.agent_tools.temporal_bridge import emit_tool_signal, temporal_available
from app.services.knowledge import fetch_active_knowledge, format_knowledge_for_prompt

EXAMPLE_TAG = "example"


class LookupKnowledgeArgs(BaseModel):
    """Arguments for :func:`lookup_org_knowledge`."""

    topic: str = Field(
        ...,
        description="What the caller asked about (e.g. 'hours', 'pricing', 'how to book').",
    )


@register(
    name="lookup_org_knowledge",
    description=(
        "Look up the organization's knowledge base to answer a caller's factual "
        "question (hours, services, booking policy). Use before answering any "
        "org-specific question; do not invent facts."
    ),
    args_model=LookupKnowledgeArgs,
    channels=None,  # read-only + side-effect-free => safe on every channel
    durable=False,
    tags=[EXAMPLE_TAG],
)
async def lookup_org_knowledge(context: ToolContext, args: LookupKnowledgeArgs) -> str:
    """Fetch active org knowledge and return it as a compact grounding block.

    Read-only: reuses ``app.services.knowledge`` (the same helper the SMS
    compose node and voice bootstrap already use), so grounding never drifts
    between the tool path and the prompt-injection path.
    """
    entries = await fetch_active_knowledge(context.org_id)
    if not entries:
        return "No knowledge base entries are available for this organization."
    # ``args.topic`` is intentionally not used to pre-filter here — the model
    # sees the compact block and picks the relevant facts. A real tool could
    # rank/filter by topic; kept simple so the example stays about wiring.
    return format_knowledge_for_prompt(entries)


class RequestMeetingArgs(BaseModel):
    """Arguments for :func:`request_meeting`."""

    preferred_time: str = Field(
        ...,
        description="The caller's stated preferred day/time in their own words.",
    )
    notes: str = Field(default="", description="Any extra context the caller gave.")


@register(
    name="request_meeting",
    description=(
        "Record that the caller wants to schedule a meeting. Call this once the "
        "caller states a preference; it hands off to the outreach system rather "
        "than booking directly. Confirm the request verbally after calling."
    ),
    args_model=RequestMeetingArgs,
    channels=["sms", "voice"],  # a mutating action, only on live conversational channels
    durable=True,  # side effect must route through Temporal
    tags=[EXAMPLE_TAG],
)
async def request_meeting(context: ToolContext, args: RequestMeetingArgs) -> str:
    """Emit a durable meeting-request signal; do not book inline.

    Demonstrates the durable pattern: the tool body performs no scheduling
    itself. It delivers a signal to the contact's ``ContactLoopWorkflow`` and
    returns an acknowledgement string for the LLM to speak/send. The decision
    engine decides what task (if any) to emit, so compliance guardrails and
    idempotency still gate the real effect.
    """
    if temporal_available() is None:
        # Playground/console session with no durable runtime — acknowledge
        # without pretending the request was persisted.
        return (
            "I have noted your meeting preference, but scheduling is not available "
            "in this session."
        )

    # ``type`` must be a valid ``SignalType`` literal — an agent-initiated event
    # uses ``"manual"`` and carries its intent in the payload (a ``tool`` key the
    # decision engine can branch on). Do not invent a new ``type`` string without
    # adding it to ``app/schemas/signals.py::SignalType`` first.
    await emit_tool_signal(
        context,
        signal_type="manual",
        payload={
            "tool": "request_meeting",
            "preferred_time": args.preferred_time,
            "notes": args.notes,
        },
    )
    return (
        "Thanks, I have passed your meeting request to our team along with your "
        "preferred time. Someone will follow up to confirm."
    )
