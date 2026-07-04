"""This file contains the knowledge schema for the application (Supabase `knowledge` table)."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse


class Knowledge(BaseResponse):
    """A clinic knowledge entry (hours, parking, pricing, policies, FAQ answers).

    Attributes:
        id: Knowledge entry ID.
        org_id: The organization this entry belongs to.
        name: Short label for the knowledge entry.
        content: The knowledge content the agent draws on when talking to contacts.
        created_at: When the entry was created.
        updated_at: When the entry was last updated.
    """

    id: UUID = Field(..., description="Knowledge entry ID")
    org_id: UUID = Field(..., description="The organization this entry belongs to")
    name: str = Field(..., description="Short label for the knowledge entry")
    content: str = Field(..., description="The knowledge content the agent draws on")
    created_at: datetime = Field(..., description="When the entry was created")
    updated_at: datetime = Field(..., description="When the entry was last updated")
