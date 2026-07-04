"""Clinic knowledge-base endpoints for the API.

Authorization comes from Postgres Row Level Security via the caller's
forwarded Supabase JWT — org members can read, org admins can manage.
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
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.knowledge import Knowledge
from app.services.supabase_client import execute_query, get_user_client

router = APIRouter()


class CreateKnowledgeRequest(BaseModel):
    """Request body for creating a knowledge entry."""

    name: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)


class UpdateKnowledgeRequest(BaseModel):
    """Request body for updating a knowledge entry."""

    name: str | None = Field(default=None, max_length=200)
    content: str | None = None


@router.get("/organizations/{org_id}/knowledge", response_model=List[Knowledge])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def list_knowledge(request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """List an organization's knowledge entries.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to list knowledge for.
        user: The authenticated Supabase user.

    Returns:
        List[Knowledge]: The organization's knowledge entries.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("knowledge").select("*").eq("org_id", str(org_id)))
        return [Knowledge(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_knowledge_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/organizations/{org_id}/knowledge", response_model=Knowledge)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def create_knowledge(
    request: Request, org_id: UUID, body: CreateKnowledgeRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Create a knowledge entry. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to add knowledge to.
        body: The knowledge entry to create.
        user: The authenticated Supabase user.

    Returns:
        Knowledge: The created knowledge entry.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("knowledge").insert({**body.model_dump(), "org_id": str(org_id)})
        )
        logger.info("knowledge_created", org_id=str(org_id), user_id=str(user.id))
        return Knowledge(**response.data[0])
    except APIError as e:
        logger.exception("create_knowledge_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.patch("/organizations/{org_id}/knowledge/{knowledge_id}", response_model=Knowledge)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def update_knowledge(
    request: Request,
    org_id: UUID,
    knowledge_id: UUID,
    body: UpdateKnowledgeRequest,
    user: SupabaseUser = Depends(get_current_user),
):
    """Update a knowledge entry. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the entry belongs to.
        knowledge_id: The ID of the knowledge entry to update.
        body: The fields to update.
        user: The authenticated Supabase user.

    Returns:
        Knowledge: The updated knowledge entry.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("knowledge")
            .update(body.model_dump(exclude_none=True))
            .eq("id", str(knowledge_id))
            .eq("org_id", str(org_id))
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Knowledge entry not found or not permitted")

        logger.info("knowledge_updated", org_id=str(org_id), knowledge_id=str(knowledge_id))
        return Knowledge(**response.data[0])
    except APIError as e:
        logger.exception("update_knowledge_failed", knowledge_id=str(knowledge_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.delete("/organizations/{org_id}/knowledge/{knowledge_id}")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def delete_knowledge(
    request: Request, org_id: UUID, knowledge_id: UUID, user: SupabaseUser = Depends(get_current_user)
):
    """Delete a knowledge entry. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the entry belongs to.
        knowledge_id: The ID of the knowledge entry to delete.
        user: The authenticated Supabase user.

    Returns:
        dict: A message confirming deletion.
    """
    client = await get_user_client(user.access_token)
    try:
        await execute_query(
            client.table("knowledge").delete().eq("id", str(knowledge_id)).eq("org_id", str(org_id))
        )
        logger.info("knowledge_deleted", org_id=str(org_id), knowledge_id=str(knowledge_id))
        return {"message": "Knowledge entry deleted successfully"}
    except APIError as e:
        logger.exception("delete_knowledge_failed", knowledge_id=str(knowledge_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
