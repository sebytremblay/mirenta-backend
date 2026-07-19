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


class VoiceAvailabilityRequest(BaseModel):
    """Agent asks for the org's open calendar slots during a live call."""

    org_id: str
    contact_id: str
    weekdays: list[str] = Field(
        default_factory=list,
        description="Optional weekday names to restrict to (e.g. ['monday', 'wednesday']).",
    )


class VoiceSlot(BaseModel):
    """One open bookable slot, with a spoken label and machine-precise bounds."""

    start: str = Field(..., description="Slot start, ISO 8601 with timezone offset")
    end: str = Field(..., description="Slot end, ISO 8601 with timezone offset")
    label: str = Field(..., description="Spoken-friendly label, e.g. 'Monday, July 21 at 9:00 AM'")


class VoiceAvailabilityResponse(BaseModel):
    """Open slots for the agent to offer, or a not-connected signal."""

    connected: bool = Field(..., description="False when the org has not linked Google Calendar")
    timezone: str = Field(..., description="IANA timezone the slots are expressed in")
    slots: list[VoiceSlot] = Field(default_factory=list)


class VoiceScheduleRequest(BaseModel):
    """Agent books a chosen slot; Mirenta confirms by email as part of booking."""

    org_id: str
    contact_id: str
    start: str = Field(..., description="Chosen slot start, ISO 8601 (copied from an availability slot)")
    end: str = Field(..., description="Chosen slot end, ISO 8601 (copied from an availability slot)")
    location: str | None = Field(default=None, description="Meeting location as free text (e.g. a listing address)")
    summary: str | None = Field(default=None, description="Optional event title override")
    notes: str | None = Field(default=None, description="Optional extra context for the event description")
    email: str | None = Field(
        default=None,
        description="Caller's email for the confirmation; falls back to the contact's email on file when omitted",
    )


class VoiceScheduleResponse(BaseModel):
    """Result of a booking attempt.

    Booking sends the confirmation email itself (built in, not a separate tool):
    when the event is created, Mirenta emails the caller from the org's
    connected Google account. ``email_sent`` reports whether that confirmation
    reached a recipient; ``email_to`` is the address it went to when known.
    """

    booked: bool = Field(..., description="True when the calendar event was created")
    connected: bool = Field(..., description="False when the org has not linked Google Calendar")
    start: str | None = Field(default=None, description="Confirmed start, ISO 8601")
    end: str | None = Field(default=None, description="Confirmed end, ISO 8601")
    email_sent: bool = Field(default=False, description="Whether the confirmation email reached the caller")
    email_to: str | None = Field(default=None, description="Address the confirmation email was sent to, when known")
    label: str | None = Field(default=None, description="Spoken-friendly confirmation label")
