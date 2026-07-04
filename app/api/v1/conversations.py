"""Outreach conversation endpoints for the API.

Read-only: the agent runtime owns writes to `conversations`, `messages`,
`call_sessions`, and `call_transcripts` via the service-role key (see
`docs/database.md`) — the dashboard only ever reads these tables, scoped by
Row Level Security via the caller's forwarded Supabase JWT.
"""

from typing import List
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from postgrest.exceptions import APIError

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.conversations import Conversation, TimelineEntry
from app.services.supabase_client import execute_query, get_user_client

router = APIRouter()


@router.get("/organizations/{org_id}/conversations", response_model=List[Conversation])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["conversations"][0])
async def list_conversations(request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """List an organization's outreach conversations.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to list conversations for.
        user: The authenticated Supabase user.

    Returns:
        List[Conversation]: The organization's conversations.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("conversations").select("*").eq("org_id", str(org_id)))
        return [Conversation(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_conversations_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/conversations/{conversation_id}/timeline", response_model=List[TimelineEntry])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["conversations"][0])
async def get_conversation_timeline(
    request: Request, conversation_id: UUID, user: SupabaseUser = Depends(get_current_user)
):
    """Get the unified SMS + voice timeline for a conversation.

    Args:
        request: The FastAPI request object for rate limiting.
        conversation_id: The conversation to fetch the timeline for.
        user: The authenticated Supabase user.

    Returns:
        List[TimelineEntry]: The conversation's timeline, oldest first.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("conversation_timeline")
            .select("*")
            .eq("conversation_id", str(conversation_id))
            .order("occurred_at")
        )
        return [TimelineEntry(**row) for row in response.data]
    except APIError as e:
        logger.exception("get_conversation_timeline_failed", conversation_id=str(conversation_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
