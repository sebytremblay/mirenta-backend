"""This file contains the profile schema for the application (Supabase `profiles` table)."""

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse


class Profile(BaseResponse):
    """A clinic-staff profile, 1:1 with the Supabase `auth.users` table.

    Attributes:
        id: Profile ID, 1:1 with auth.users.id.
        full_name: Display name shown across the dashboard.
        avatar_url: URL of the user's avatar image.
        onboarding_completed: Whether the user has finished the onboarding flow.
        created_at: When the profile was created.
        updated_at: When the profile was last updated.
    """

    id: UUID = Field(..., description="Profile ID, 1:1 with auth.users.id")
    full_name: str | None = Field(default=None, description="Display name shown across the dashboard")
    avatar_url: str | None = Field(default=None, description="URL of the user's avatar image")
    onboarding_completed: bool = Field(default=False, description="Whether onboarding has been completed")
    created_at: datetime = Field(..., description="When the profile was created")
    updated_at: datetime = Field(..., description="When the profile was last updated")
