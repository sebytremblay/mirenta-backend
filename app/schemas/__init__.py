"""This file contains the schemas for the application."""

from app.schemas.appointments import Appointment, AppointmentStatus
from app.schemas.auth import SupabaseUser
from app.schemas.base import BaseResponse
from app.schemas.chat import Message
from app.schemas.contacts import Contact
from app.schemas.conversations import (
    CallDirection,
    CallSession,
    CallTranscript,
    Channel,
    Conversation,
    ConversationStatus,
    MessageDeliveryStatus,
    SmsMessage,
    SpeakerType,
    TimelineEntry,
)
from app.schemas.graph import GraphState
from app.schemas.knowledge import Knowledge
from app.schemas.organizations import (
    MemberRole,
    Organization,
    OrganizationMember,
)
from app.schemas.profiles import Profile

__all__ = [
    "SupabaseUser",
    "BaseResponse",
    "Message",
    "GraphState",
    "Profile",
    "MemberRole",
    "Organization",
    "OrganizationMember",
    "Knowledge",
    "Contact",
    "ConversationStatus",
    "Channel",
    "SpeakerType",
    "MessageDeliveryStatus",
    "CallDirection",
    "Conversation",
    "SmsMessage",
    "CallSession",
    "CallTranscript",
    "TimelineEntry",
    "AppointmentStatus",
    "Appointment",
]
