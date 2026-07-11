"""This file contains the Supabase client factories for the application."""

import asyncio
from typing import Any

import httpx
from supabase import AsyncClient, acreate_client
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings

_service_role_client: AsyncClient | None = None
_service_role_lock = asyncio.Lock()


async def get_service_role_client() -> AsyncClient:
    """Get the privileged Supabase client used by the agent runtime.

    This client authenticates with the secret key, which bypasses Row Level
    Security entirely. Only use it for agent-runtime writes (outreach
    conversations, messages, calls, appointments) — never for requests made
    on behalf of a dashboard user.

    Returns:
        AsyncClient: A cached Supabase client authenticated with the secret key.
    """
    global _service_role_client
    if _service_role_client is None:
        async with _service_role_lock:
            if _service_role_client is None:
                _service_role_client = await acreate_client(settings.SUPABASE_URL, settings.SUPABASE_SECRET_KEY)
    return _service_role_client


async def get_user_client(access_token: str) -> AsyncClient:
    """Get an RLS-scoped Supabase client acting as the calling dashboard user.

    Args:
        access_token: The caller's Supabase-issued JWT, forwarded to PostgREST
            so `auth.uid()` resolves to the calling user and Row Level Security
            policies enforce org-membership authorization automatically.

    Returns:
        AsyncClient: A Supabase client authenticated with the publishable key,
            scoped to the calling user via the forwarded access token.
    """
    client = await acreate_client(settings.SUPABASE_URL, settings.SUPABASE_PUBLISHABLE_KEY)
    client.postgrest.auth(access_token)
    return client


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception_type((httpx.ConnectError, httpx.TimeoutException)),
    reraise=True,
)
async def execute_query(builder: Any) -> Any:
    """Execute a PostgREST query builder, retrying on transient network errors.

    Does not retry on `APIError` (RLS denials, not-found, validation errors) —
    those are application-level responses, not transient failures.

    Args:
        builder: A PostgREST query builder, e.g. `client.table("organizations").select("*")`.

    Returns:
        The query response (`.data` is a dict for `.single()` queries, a list otherwise).
    """
    return await builder.execute()
