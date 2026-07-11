"""Profile endpoints for the authenticated caller.

Authorization comes from Postgres RLS (`profiles_select_own` /
`profiles_update_own`) via the caller's forwarded Supabase JWT — same
pattern as organizations. Profiles are 1:1 with `auth.users` and
auto-provisioned on sign-up.
"""

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.profiles import Profile
from app.services.clients.supabase_client import execute_query, get_user_client

router = APIRouter()


class UpdateProfileRequest(BaseModel):
    """Request body for updating the caller's profile."""

    full_name: str | None = Field(default=None, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=2048)
    onboarding_completed: bool | None = None


@router.get("/profiles/me", response_model=Profile)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["profiles"][0])
async def get_my_profile(request: Request, user: SupabaseUser = Depends(get_current_user)):
    """Get the caller's profile.

    Args:
        request: The FastAPI request object for rate limiting.
        user: The authenticated Supabase user.

    Returns:
        Profile: The caller's profile row.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("profiles").select("*").eq("id", str(user.id)).single())
        return Profile(**response.data)
    except APIError as e:
        logger.warning("profile_not_found", user_id=str(user.id), error=e.message)
        raise HTTPException(status_code=404, detail="Profile not found")


@router.patch("/profiles/me", response_model=Profile)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["profiles"][0])
async def update_my_profile(
    request: Request, body: UpdateProfileRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Update the caller's profile (display name, avatar, onboarding flag).

    Args:
        request: The FastAPI request object for rate limiting.
        body: The fields to update.
        user: The authenticated Supabase user.

    Returns:
        Profile: The updated profile.
    """
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("profiles").update(updates).eq("id", str(user.id)))
        if not response.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        logger.info("profile_updated", user_id=str(user.id), fields=list(updates.keys()))
        return Profile(**response.data[0])
    except APIError as e:
        logger.exception("profile_update_failed", user_id=str(user.id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
