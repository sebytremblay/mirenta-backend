"""Organization knowledge-base CRUD endpoints.

Authorization comes from Postgres RLS (`is_org_member` / `is_org_admin`) via
the caller's forwarded Supabase JWT — same pattern as organizations/contacts.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.knowledge import Knowledge, KnowledgeKind
from app.services.clients.supabase_client import execute_query, get_user_client

router = APIRouter()


class CreateKnowledgeRequest(BaseModel):
    """Request body for creating a knowledge entry."""

    kind: KnowledgeKind = "general"
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=8000)
    metadata: dict = Field(default_factory=dict)
    is_active: bool = True


class UpdateKnowledgeRequest(BaseModel):
    """Request body for updating a knowledge entry."""

    kind: KnowledgeKind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    metadata: dict | None = None
    is_active: bool | None = None


@router.get("/organizations/{org_id}/knowledge", response_model=list[Knowledge])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def list_knowledge(
    request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)
) -> list[Knowledge]:
    """List knowledge entries for an organization (members can read)."""
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("knowledge")
            .select("*")
            .eq("org_id", str(org_id))
            .order("kind")
            .order("created_at", desc=True)
        )
    except APIError as e:
        logger.exception("knowledge_list_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
    return [Knowledge(**row) for row in (response.data or [])]


@router.post("/organizations/{org_id}/knowledge", response_model=Knowledge)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def create_knowledge(
    request: Request,
    org_id: UUID,
    body: CreateKnowledgeRequest,
    user: SupabaseUser = Depends(get_current_user),
) -> Knowledge:
    """Create a knowledge entry (admins only via RLS)."""
    client = await get_user_client(user.access_token)
    row = {"org_id": str(org_id), **body.model_dump()}
    try:
        response = await execute_query(client.table("knowledge").insert(row))
        entry = Knowledge(**response.data[0])
        logger.info("knowledge_created", org_id=str(org_id), knowledge_id=str(entry.id), user_id=str(user.id))
        return entry
    except APIError as e:
        logger.exception("knowledge_create_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.patch("/organizations/{org_id}/knowledge/{knowledge_id}", response_model=Knowledge)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def update_knowledge(
    request: Request,
    org_id: UUID,
    knowledge_id: UUID,
    body: UpdateKnowledgeRequest,
    user: SupabaseUser = Depends(get_current_user),
) -> Knowledge:
    """Update a knowledge entry (admins only via RLS)."""
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="no fields to update")
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("knowledge").update(patch).eq("id", str(knowledge_id)).eq("org_id", str(org_id))
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="knowledge entry not found")
        entry = Knowledge(**response.data[0])
        logger.info("knowledge_updated", org_id=str(org_id), knowledge_id=str(knowledge_id))
        return entry
    except HTTPException:
        raise
    except APIError as e:
        logger.exception("knowledge_update_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.delete("/organizations/{org_id}/knowledge/{knowledge_id}", status_code=204)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["knowledge"][0])
async def delete_knowledge(
    request: Request,
    org_id: UUID,
    knowledge_id: UUID,
    user: SupabaseUser = Depends(get_current_user),
) -> None:
    """Delete a knowledge entry (admins only via RLS)."""
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("knowledge").delete().eq("id", str(knowledge_id)).eq("org_id", str(org_id)).select("id")
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="knowledge entry not found")
        logger.info("knowledge_deleted", org_id=str(org_id), knowledge_id=str(knowledge_id))
    except HTTPException:
        raise
    except APIError as e:
        logger.exception("knowledge_delete_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
