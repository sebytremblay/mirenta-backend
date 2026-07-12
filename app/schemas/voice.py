"""Request/response schemas for the LiveKit voice agent ↔ FastAPI bridge."""

from typing import Any

from pydantic import BaseModel, Field


class VoiceSessionBootstrapRequest(BaseModel):
    """Agent asks Mirenta for call context after joining a LiveKit room."""

    org_id: str
    contact_id: str
    signal_id: str
    call_sid: str
    room_name: str | None = None


class VoiceSessionBootstrapResponse(BaseModel):
    """Instructions + grounding context for the LiveKit native LLM pipeline."""

    org_id: str
    contact_id: str
    signal_id: str
    call_sid: str
    persona_name: str
    greeting: str
    instructions: str
    knowledge: str = ""


class VoiceSessionFinalizeRequest(BaseModel):
    """Agent posts the finished call transcript so Mirenta can close the loop."""

    org_id: str
    contact_id: str
    signal_id: str
    call_sid: str
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    outcome: str | None = None
    summary: str | None = None
    room_name: str | None = None


class VoiceSessionFinalizeResponse(BaseModel):
    """Ids written when the call is logged and re-enters ContactLoopWorkflow."""

    interaction_id: str
    signal_id: str
