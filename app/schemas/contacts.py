"""This file contains the contact schema for the application (Supabase `contacts` table)."""

import re
from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.schemas.base import BaseResponse

E164_PATTERN = re.compile(r"^\+[1-9]\d{1,14}$")


class Contact(BaseResponse):
    """A pet owner on a clinic's recall list.

    Attributes:
        id: Contact ID.
        org_id: The organization this contact belongs to.
        first_name: The contact's first name.
        last_name: The contact's last name.
        email: The contact's email address.
        phone: The contact's phone number, in E.164 format.
        first_seen_at: When the contact first appeared in the clinic's PMS export.
        last_seen_at: The contact's last visit or last touch.
        opted_out_at: When the contact opted out (TCPA); once set, the agent goes permanently silent.
        created_at: When the contact record was created.
        updated_at: When the contact record was last updated.
    """

    id: UUID = Field(..., description="Contact ID")
    org_id: UUID = Field(..., description="The organization this contact belongs to")
    first_name: str | None = Field(default=None, description="The contact's first name")
    last_name: str | None = Field(default=None, description="The contact's last name")
    email: str | None = Field(default=None, description="The contact's email address")
    phone: str | None = Field(default=None, description="The contact's phone number, in E.164 format")
    first_seen_at: datetime | None = Field(
        default=None, description="When the contact first appeared in the clinic's PMS export"
    )
    last_seen_at: datetime | None = Field(default=None, description="The contact's last visit or last touch")
    opted_out_at: datetime | None = Field(
        default=None, description="When the contact opted out (TCPA); once set, the agent goes permanently silent"
    )
    created_at: datetime = Field(..., description="When the contact record was created")
    updated_at: datetime = Field(..., description="When the contact record was last updated")

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str | None) -> str | None:
        """Validate the phone number is in E.164 format, e.g. +14155551234."""
        if v is not None and not E164_PATTERN.fullmatch(v):
            raise ValueError("Phone number must be in E.164 format, e.g. +14155551234")
        return v
