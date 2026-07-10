"""This file contains the contact schema for the application.

Covers the Supabase `contacts`, `contact_state`, and `consent` tables, and
the `current_consent` view (see `supabase/migrations/0003_contacts.sql`).
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse

Channel = Literal["sms", "email", "voice", "webhook", "portal"]
ContactStatus = Literal["active", "paused", "archived", "dnc"]


class Contact(BaseResponse):
    """A contact on a clinic's recall list.

    Attributes:
        id: Contact ID.
        org_id: The organization this contact belongs to.
        external_id: ID in the source CRM/PMS system, unique per org.
        first_name: The contact's first name.
        last_name: The contact's last name.
        phone: The contact's phone number, E.164 format.
        email: The contact's email address.
        timezone: IANA timezone, drives quiet-hours scheduling.
        status: The contact's lifecycle status.
        attributes: Arbitrary CRM fields carried over from the source system.
        created_at: When the contact was created.
        updated_at: When the contact was last updated.
    """

    id: UUID = Field(..., description="Contact ID")
    org_id: UUID = Field(..., description="The organization this contact belongs to")
    external_id: str | None = Field(default=None, description="ID in the source CRM/PMS system")
    first_name: str | None = Field(default=None, description="The contact's first name")
    last_name: str | None = Field(default=None, description="The contact's last name")
    phone: str | None = Field(default=None, description="The contact's phone number, E.164 format")
    email: str | None = Field(default=None, description="The contact's email address")
    timezone: str = Field(default="America/Los_Angeles", description="IANA timezone, drives quiet-hours scheduling")
    status: ContactStatus = Field(default="active", description="The contact's lifecycle status")
    attributes: dict[str, Any] = Field(default_factory=dict, description="Arbitrary CRM fields")
    created_at: datetime = Field(..., description="When the contact was created")
    updated_at: datetime = Field(..., description="When the contact was last updated")


class ContactState(BaseResponse):
    """1:1 mutable workflow state for a contact, read by the decision engine.

    Attributes:
        contact_id: The contact this state belongs to.
        org_id: The organization this state belongs to.
        current_state: The decision-engine state-machine node.
        goal: The current objective, e.g. 'book_appointment'.
        temporal_workflow_id: The running ContactLoopWorkflow ID.
        last_contacted_at: When the contact was last reached.
        contact_attempts: Rolling attempt counter for frequency caps.
        attempts_window_start: Start of the current frequency-cap window.
        next_task_at: Convenience mirror of the earliest scheduled task.
        memory_summary: Rolling summary injected into agent context.
        data: Free-form state for rules.
        updated_at: When the state was last updated.
    """

    contact_id: UUID = Field(..., description="The contact this state belongs to")
    org_id: UUID = Field(..., description="The organization this state belongs to")
    current_state: str = Field(default="new", description="The decision-engine state-machine node")
    goal: str | None = Field(default=None, description="The current objective, e.g. 'book_appointment'")
    temporal_workflow_id: str | None = Field(default=None, description="The running ContactLoopWorkflow ID")
    last_contacted_at: datetime | None = Field(default=None, description="When the contact was last reached")
    contact_attempts: int = Field(default=0, description="Rolling attempt counter for frequency caps")
    attempts_window_start: datetime | None = Field(
        default=None, description="Start of the current frequency-cap window"
    )
    next_task_at: datetime | None = Field(
        default=None, description="Convenience mirror of the earliest scheduled task"
    )
    memory_summary: str | None = Field(default=None, description="Rolling summary injected into agent context")
    data: dict[str, Any] = Field(default_factory=dict, description="Free-form state for rules")
    updated_at: datetime = Field(..., description="When the state was last updated")


class Consent(BaseResponse):
    """A per-channel consent decision. Never updated in place — revoke + re-grant.

    Attributes:
        id: Consent record ID.
        org_id: The organization this consent belongs to.
        contact_id: The contact this consent belongs to.
        channel: The channel this consent decision applies to.
        granted: Whether consent was granted (True) or revoked (False).
        source: Where the decision came from, e.g. 'web_form', 'sms_reply', 'agent_call', 'import'.
        note: Optional free-form note.
        occurred_at: When the decision took effect.
        created_at: When the record was written.
    """

    id: UUID = Field(..., description="Consent record ID")
    org_id: UUID = Field(..., description="The organization this consent belongs to")
    contact_id: UUID = Field(..., description="The contact this consent belongs to")
    channel: Channel = Field(..., description="The channel this consent decision applies to")
    granted: bool = Field(..., description="Whether consent was granted (True) or revoked (False)")
    source: str = Field(..., description="Where the decision came from")
    note: str | None = Field(default=None, description="Optional free-form note")
    occurred_at: datetime = Field(..., description="When the decision took effect")
    created_at: datetime = Field(..., description="When the record was written")


class CurrentConsent(BaseResponse):
    """The latest consent decision per contact/channel — the `current_consent` view.

    Attributes:
        contact_id: The contact this consent belongs to.
        channel: The channel this consent decision applies to.
        granted: Whether consent is currently granted.
        source: Where the latest decision came from.
        occurred_at: When the latest decision took effect.
    """

    contact_id: UUID = Field(..., description="The contact this consent belongs to")
    channel: Channel = Field(..., description="The channel this consent decision applies to")
    granted: bool = Field(..., description="Whether consent is currently granted")
    source: str = Field(..., description="Where the latest decision came from")
    occurred_at: datetime = Field(..., description="When the latest decision took effect")
