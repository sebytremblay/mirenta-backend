"""This file contains the outreach conversation schema for the application.

Covers the Supabase `conversations`, `messages`, `call_sessions`, and `call_transcripts`
tables, plus the `conversation_timeline` view.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import BaseResponse

ConversationStatus = Literal["active", "paused", "booked", "opted_out", "handed_off", "stale"]
Channel = Literal["sms", "voice"]
SpeakerType = Literal["agent", "contact"]
MessageDeliveryStatus = Literal["sent", "delivered", "failed"]
CallDirection = Literal["inbound", "outbound"]


class Conversation(BaseResponse):
    """An outreach campaign / logical window of interaction with a contact.

    Attributes:
        id: Conversation ID.
        org_id: The organization this conversation belongs to.
        contact_id: The contact this conversation is with.
        goal: The outreach goal, e.g. "annual_exam_recall".
        status: The conversation's current lifecycle status.
        last_channel: The channel used for the most recent turn.
        next_scheduled_action_at: When the follow-up timer fires next, if any.
        created_at: When the conversation was opened.
        updated_at: When the conversation was last updated.
    """

    id: UUID = Field(..., description="Conversation ID")
    org_id: UUID = Field(..., description="The organization this conversation belongs to")
    contact_id: UUID = Field(..., description="The contact this conversation is with")
    goal: str | None = Field(default=None, description='The outreach goal, e.g. "annual_exam_recall"')
    status: ConversationStatus = Field(default="active", description="The conversation's current lifecycle status")
    last_channel: Channel | None = Field(default=None, description="The channel used for the most recent turn")
    next_scheduled_action_at: datetime | None = Field(
        default=None, description="When the follow-up timer fires next, if any"
    )
    created_at: datetime = Field(..., description="When the conversation was opened")
    updated_at: datetime = Field(..., description="When the conversation was last updated")


class SmsMessage(BaseResponse):
    """A single SMS message logged on a conversation.

    Attributes:
        id: Message ID.
        conversation_id: The conversation this message belongs to.
        sender_type: Who sent the message.
        body: The message body.
        status: The provider's delivery status.
        provider_id: The provider's message ID (e.g. Twilio SID), for webhook reconciliation.
        created_at: When the message was logged.
    """

    id: UUID = Field(..., description="Message ID")
    conversation_id: UUID = Field(..., description="The conversation this message belongs to")
    sender_type: SpeakerType = Field(..., description="Who sent the message")
    body: str = Field(..., description="The message body")
    status: MessageDeliveryStatus | None = Field(default=None, description="The provider's delivery status")
    provider_id: str | None = Field(default=None, description="The provider's message ID (e.g. Twilio SID)")
    created_at: datetime = Field(..., description="When the message was logged")


class CallSession(BaseResponse):
    """Call-level metadata for a voice interaction on a conversation.

    Attributes:
        id: Call session ID.
        conversation_id: The conversation this call belongs to.
        direction: Whether the call was inbound or outbound.
        duration_seconds: The call's duration in seconds.
        recording_url: URL of the call recording, if any.
        provider_id: The telephony provider's call ID.
        created_at: When the call session was logged.
    """

    id: UUID = Field(..., description="Call session ID")
    conversation_id: UUID = Field(..., description="The conversation this call belongs to")
    direction: CallDirection = Field(..., description="Whether the call was inbound or outbound")
    duration_seconds: int | None = Field(default=None, description="The call's duration in seconds")
    recording_url: str | None = Field(default=None, description="URL of the call recording, if any")
    provider_id: str | None = Field(default=None, description="The telephony provider's call ID")
    created_at: datetime = Field(..., description="When the call session was logged")


class CallTranscript(BaseResponse):
    """A single turn in a call transcript.

    Attributes:
        id: Transcript turn ID.
        call_session_id: The call session this turn belongs to.
        speaker: Who spoke this turn.
        utterance: The transcribed text for this turn.
        turn_index: Explicit ordering of this turn within the call.
        created_at: When the turn was recorded.
    """

    id: UUID = Field(..., description="Transcript turn ID")
    call_session_id: UUID = Field(..., description="The call session this turn belongs to")
    speaker: SpeakerType = Field(..., description="Who spoke this turn")
    utterance: str = Field(..., description="The transcribed text for this turn")
    turn_index: int = Field(..., description="Explicit ordering of this turn within the call")
    created_at: datetime = Field(..., description="When the turn was recorded")


class TimelineEntry(BaseModel):
    """A single entry from the unified `conversation_timeline` view, merging SMS and voice turns.

    Attributes:
        conversation_id: The conversation this entry belongs to.
        channel: Which channel this entry occurred on.
        speaker: Who sent this entry.
        content: The message body or transcribed utterance.
        occurred_at: When this entry occurred, used to order the feed.
    """

    conversation_id: UUID = Field(..., description="The conversation this entry belongs to")
    channel: Channel = Field(..., description="Which channel this entry occurred on")
    speaker: SpeakerType = Field(..., description="Who sent this entry")
    content: str = Field(..., description="The message body or transcribed utterance")
    occurred_at: datetime = Field(..., description="When this entry occurred, used to order the feed")
