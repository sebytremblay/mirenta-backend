"""Shared FastAPI dependencies for the API routers."""

from uuid import UUID

from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.services.supabase_client import execute_query, get_user_client


async def assert_org_member(user: SupabaseUser, org_id: UUID) -> None:
    """Raise 404 unless the caller is a member of `org_id`.

    `organizations` carries `is_org_member`/`is_org_admin` RLS policies, so a
    `select` through the caller's forwarded JWT succeeds only for members.
    The agent-loop tables (`contacts`, `contact_state`, `consent`, `signals`,
    `tasks`, `interactions`, `contact_memory`) have RLS enabled with no
    policies of their own — locked to the service role — so routers touching
    them call this first for authorization, then switch to
    `get_service_role_client()` for the actual query. See
    docs/database.md#row-level-security.

    Args:
        user: The authenticated Supabase user.
        org_id: The organization the caller must belong to.

    Raises:
        HTTPException: 404 if the caller isn't a member of `org_id` — mirrors
            the RLS denial rather than distinguishing "not found" from
            "forbidden", so org existence isn't leaked to non-members.
    """
    client = await get_user_client(user.access_token)
    try:
        await execute_query(client.table("organizations").select("id").eq("id", str(org_id)).single())
    except APIError as e:
        logger.warning("org_membership_check_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=404, detail="Organization not found")
