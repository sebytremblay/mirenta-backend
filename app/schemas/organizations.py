"""This file contains the organization schema for the application.

Covers the Supabase `organizations` and `organization_members` tables.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse

MemberRole = Literal["owner", "admin", "member"]


class Organization(BaseResponse):
    """A clinic (or clinic group).

    Attributes:
        id: Organization ID.
        name: The clinic's display name.
        slug: Unique URL-safe identifier for the org.
        website_url: The clinic's public website.
        phone: The clinic's Twilio number (E.164); inbound SMS/voice route on this.
        twilio_subaccount_sid: Per-org Twilio subaccount (ISV isolation).
        twilio_phone_sid: IncomingPhoneNumber SID for `phone`.
        twilio_messaging_service_sid: Messaging Service used for outbound SMS.
        timezone: IANA timezone used to schedule outreach.
        created_at: When the org was created.
        updated_at: When the org was last updated.
    """

    id: UUID = Field(..., description="Organization ID")
    name: str = Field(..., description="The clinic's display name")
    slug: str = Field(..., description="Unique URL-safe identifier for the org")
    website_url: str | None = Field(default=None, description="The clinic's public website")
    phone: str | None = Field(default=None, description="The clinic's Twilio number, E.164")
    twilio_subaccount_sid: str | None = Field(default=None, description="Per-org Twilio subaccount SID")
    twilio_phone_sid: str | None = Field(default=None, description="Twilio IncomingPhoneNumber SID")
    twilio_messaging_service_sid: str | None = Field(
        default=None, description="Twilio Messaging Service SID for outbound SMS"
    )
    timezone: str = Field(default="America/Los_Angeles", description="IANA timezone used to schedule outreach")
    created_at: datetime = Field(..., description="When the org was created")
    updated_at: datetime = Field(..., description="When the org was last updated")


class OrganizationMember(BaseResponse):
    """A clinic-staff user's membership in an organization.

    Attributes:
        org_id: The organization this membership belongs to.
        user_id: The auth.users ID of the member.
        role: The member's role within the org.
        created_at: When the membership was created.
        updated_at: When the membership was last updated.
    """

    org_id: UUID = Field(..., description="The organization this membership belongs to")
    user_id: UUID = Field(..., description="The auth.users ID of the member")
    role: MemberRole = Field(default="member", description="The member's role within the org")
    created_at: datetime = Field(..., description="When the membership was created")
    updated_at: datetime = Field(..., description="When the membership was last updated")
