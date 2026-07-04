"""This file contains the authentication schema for the application."""

from uuid import UUID

from pydantic import (
    BaseModel,
    Field,
)


class SupabaseUser(BaseModel):
    """The authenticated identity extracted from a verified Supabase JWT.

    Attributes:
        id: The Supabase `auth.users` ID.
        email: The user's email address, if present in the token.
        display_name: Display name sourced from the token's `user_metadata`.
        access_token: The raw Supabase access token, forwarded to PostgREST via
            `get_user_client` so Row Level Security resolves `auth.uid()`.
    """

    id: UUID = Field(..., description="The Supabase auth.users ID")
    email: str | None = Field(default=None, description="The user's email address")
    display_name: str | None = Field(default=None, description="Display name from user_metadata")
    access_token: str = Field(..., description="The raw Supabase access token", exclude=True, repr=False)
