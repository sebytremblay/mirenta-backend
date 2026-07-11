"""Per-channel state schemas for the LangGraph subagents.

Each channel graph gets its own ``GraphState`` subclass so channel-specific
fields (e.g. a live call SID) don't leak into channels that don't need them,
even though today's fields are identical.
"""

from pydantic import Field

from app.schemas import GraphState


class SMSState(GraphState):
    """State for the SMS subagent's compose/output-guardrails loop."""

    goal: str = Field(default="", description="Task goal, e.g. 'reply_to_inbound_sms'")
    channel_constraints: dict = Field(default_factory=dict, description="e.g. {'max_length': 320}")
    draft: str | None = Field(default=None, description="Latest composed draft awaiting guardrail check")
    guardrail_attempts: int = Field(default=0, description="How many compose -> guardrail loops have run")
    guardrail_feedback: str | None = Field(default=None, description="Why the last draft failed, fed back to compose")


class VoiceState(GraphState):
    """State for the voice subagent's compose/output-guardrails loop."""

    goal: str = Field(default="", description="Task goal, e.g. 'converse_inbound_call'")
    call_sid: str | None = Field(default=None, description="The live Twilio call this turn belongs to")
    channel_constraints: dict = Field(default_factory=dict, description="e.g. {'max_length': 600}")
    draft: str | None = Field(default=None, description="Latest composed draft awaiting guardrail check")
    guardrail_attempts: int = Field(default=0, description="How many compose -> guardrail loops have run")
    guardrail_feedback: str | None = Field(default=None, description="Why the last draft failed, fed back to compose")
