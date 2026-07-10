"""This file contains the interaction schema for the application.

Covers the Supabase `interactions` table and the `contact_timeline` view
(see `supabase/migrations/0006_interactions.sql`).
"""

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse
from app.schemas.contacts import Channel

InteractionDirection = Literal["outbound", "inbound"]
InteractionOutcome = Literal[
    "goal_achieved",
    "progressed",
    "no_answer",
    "voicemail",
    "declined",
    "opt_out",
    "handoff_human",
    "error",
]
TimelineEntryKind = Literal["signal", "task", "interaction"]


class Interaction(BaseResponse):
    """A single subagent conversation across voice/SMS/email.

    Every completed interaction is logged here, then re-emitted as an
    'interaction_result' signal (`result_signal_id`) — closing the loop.

    Attributes:
        id: Interaction ID.
        org_id: The organization this interaction belongs to.
        contact_id: The contact this interaction is with.
        task_id: The task that triggered this interaction, if any.
        channel: The channel this interaction happened on.
        direction: Whether the agent initiated or the contact did.
        agent_graph: Which LangGraph agent handled this, e.g. 'sms_agent', 'voice_agent'.
        transcript: The turn-by-turn transcript.
        summary: The summarize-node output; feeds memory.
        outcome: The interaction's outcome.
        outcome_data: Structured extraction (booked slot, callback time...).
        guardrail_flags: Output-guardrail hits during the conversation.
        provider_ref: Twilio call SID / SendGrid message ID.
        recording_url: Voice recording URL, voice only.
        input_tokens: LLM input tokens used.
        output_tokens: LLM output tokens used.
        cost_usd: LLM cost in USD.
        result_signal_id: The 'interaction_result' signal re-emitted from this interaction.
        started_at: When the interaction started.
        ended_at: When the interaction ended.
        created_at: When the record was written.
    """

    id: UUID = Field(..., description="Interaction ID")
    org_id: UUID = Field(..., description="The organization this interaction belongs to")
    contact_id: UUID = Field(..., description="The contact this interaction is with")
    task_id: UUID | None = Field(default=None, description="The task that triggered this interaction, if any")
    channel: Channel = Field(..., description="The channel this interaction happened on")
    direction: InteractionDirection = Field(..., description="Whether the agent initiated or the contact did")
    agent_graph: str | None = Field(default=None, description="Which LangGraph agent handled this")
    transcript: list[dict[str, Any]] = Field(default_factory=list, description="The turn-by-turn transcript")
    summary: str | None = Field(default=None, description="The summarize-node output; feeds memory")
    outcome: InteractionOutcome | None = Field(default=None, description="The interaction's outcome")
    outcome_data: dict[str, Any] = Field(default_factory=dict, description="Structured extraction")
    guardrail_flags: list[dict[str, Any]] = Field(
        default_factory=list, description="Output-guardrail hits during the conversation"
    )
    provider_ref: str | None = Field(default=None, description="Twilio call SID / SendGrid message ID")
    recording_url: str | None = Field(default=None, description="Voice recording URL, voice only")
    input_tokens: int | None = Field(default=None, description="LLM input tokens used")
    output_tokens: int | None = Field(default=None, description="LLM output tokens used")
    cost_usd: Decimal | None = Field(default=None, description="LLM cost in USD")
    result_signal_id: UUID | None = Field(
        default=None, description="The 'interaction_result' signal re-emitted from this interaction"
    )
    started_at: datetime = Field(..., description="When the interaction started")
    ended_at: datetime | None = Field(default=None, description="When the interaction ended")
    created_at: datetime = Field(..., description="When the record was written")


class TimelineEntry(BaseResponse):
    """A row from the `contact_timeline` view (GET /contacts/{id}/timeline).

    Merges signals, tasks, and interactions into one chronological feed.

    Attributes:
        contact_id: The contact this entry belongs to.
        kind: Which source table this entry came from.
        id: The ID of the underlying signal/task/interaction row.
        occurred_at: When the entry occurred.
        label: A short human-readable label for the entry.
        data: Entry-specific data payload.
    """

    contact_id: UUID = Field(..., description="The contact this entry belongs to")
    kind: TimelineEntryKind = Field(..., description="Which source table this entry came from")
    id: UUID = Field(..., description="The ID of the underlying signal/task/interaction row")
    occurred_at: datetime = Field(..., description="When the entry occurred")
    label: str = Field(..., description="A short human-readable label for the entry")
    data: dict[str, Any] = Field(default_factory=dict, description="Entry-specific data payload")
