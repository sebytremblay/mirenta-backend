"""This file contains the schemas for the application."""

from app.schemas.auth import SupabaseUser
from app.schemas.base import BaseResponse
from app.schemas.contacts import (
    Channel,
    Consent,
    Contact,
    ContactState,
    ContactStatus,
    CurrentConsent,
)
from app.schemas.graph import GraphState
from app.schemas.interactions import (
    Interaction,
    InteractionDirection,
    InteractionOutcome,
    TimelineEntry,
    TimelineEntryKind,
)
from app.schemas.knowledge import Knowledge, KnowledgeKind
from app.schemas.memory import ContactMemory, ContactMemoryMatch, MemoryKind
from app.schemas.organizations import (
    MemberRole,
    Organization,
    OrganizationMember,
)
from app.schemas.profiles import Profile
from app.schemas.signals import Signal, SignalStatus, SignalType
from app.schemas.tasks import Task, TaskStatus, TaskType

__all__ = [
    "SupabaseUser",
    "BaseResponse",
    "GraphState",
    "Profile",
    "MemberRole",
    "Organization",
    "OrganizationMember",
    "Channel",
    "ContactStatus",
    "Contact",
    "ContactState",
    "Consent",
    "CurrentConsent",
    "SignalType",
    "SignalStatus",
    "Signal",
    "TaskType",
    "TaskStatus",
    "Task",
    "InteractionDirection",
    "InteractionOutcome",
    "Interaction",
    "TimelineEntryKind",
    "TimelineEntry",
    "KnowledgeKind",
    "Knowledge",
    "MemoryKind",
    "ContactMemory",
    "ContactMemoryMatch",
]
