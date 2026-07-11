"""This file contains the signal schema for the application.

Covers the Supabase `signals` table — everything that kicks off (or
re-enters) the agent loop (see `supabase/migrations/0004_signals.sql`).
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse
from app.schemas.contacts import Channel

SignalType = Literal[
    "webhook",
    "inbound_call",
    "inbound_sms",
    "portal_event",
    "interaction_result",
    "manual",
]
SignalStatus = Literal["received", "delivered", "processed", "ignored", "failed"]


class Signal(BaseResponse):
    """An event that kicks off (or re-enters) the agent loop for a contact.

    Attributes:
        id: Signal ID.
        org_id: The organization this signal belongs to.
        contact_id: The contact this signal relates to, if resolved yet.
        type: What kind of signal this is.
        channel: The channel the signal arrived on, if applicable.
        source: Where the signal came from, e.g. 'twilio', 'sendgrid', 'portal', 'system'.
        dedup_key: Provider message ID etc.; rejects webhook replays.
        payload: The normalized Signal model dump.
        raw_payload: The original provider body, for audit/debug.
        status: The signal's processing status.
        error: Error detail if processing failed.
        received_at: When the signal was received.
        delivered_at: When the signal was handed to the Temporal workflow.
        processed_at: When the decision engine consumed the signal.
    """

    id: UUID = Field(..., description="Signal ID")
    org_id: UUID = Field(..., description="The organization this signal belongs to")
    contact_id: UUID | None = Field(default=None, description="The contact this signal relates to, if resolved yet")
    type: SignalType = Field(..., description="What kind of signal this is")
    channel: Channel | None = Field(default=None, description="The channel the signal arrived on, if applicable")
    source: str | None = Field(default=None, description="Where the signal came from")
    dedup_key: str | None = Field(default=None, description="Provider message ID etc.; rejects webhook replays")
    payload: dict[str, Any] = Field(default_factory=dict, description="The normalized Signal model dump")
    raw_payload: dict[str, Any] | None = Field(default=None, description="The original provider body, for audit/debug")
    status: SignalStatus = Field(default="received", description="The signal's processing status")
    error: str | None = Field(default=None, description="Error detail if processing failed")
    received_at: datetime = Field(..., description="When the signal was received")
    delivered_at: datetime | None = Field(default=None, description="When handed to the Temporal workflow")
    processed_at: datetime | None = Field(default=None, description="When the decision engine consumed the signal")
