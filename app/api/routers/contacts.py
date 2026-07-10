"""Contact (recall list) endpoints for the API.

`contacts` has RLS enabled with no policies of its own — locked to the
service role, same as the rest of the agent-loop tables (`contact_state`,
`consent`, `signals`, `tasks`, `interactions`, `contact_memory` — see
`docs/database.md#row-level-security`). So every endpoint here checks org
membership explicitly via `assert_org_member` (which does go through RLS,
against `organizations`) and then reads/writes through
`get_service_role_client()`.
"""

from typing import Any, List
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
)
from postgrest.exceptions import APIError
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import assert_org_member
from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.contacts import Contact, ContactStatus
from app.schemas.interactions import TimelineEntry
from app.services.supabase_client import execute_query, get_service_role_client

router = APIRouter()


class CreateContactRequest(BaseModel):
    """Request body for adding a contact to an organization's recall list."""

    external_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    timezone: str = "America/Los_Angeles"
    status: ContactStatus = "active"
    attributes: dict[str, Any] = Field(default_factory=dict)


class UpdateContactRequest(BaseModel):
    """Request body for updating a contact."""

    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    timezone: str | None = None
    status: ContactStatus | None = None
    attributes: dict[str, Any] | None = None


@router.get("/organizations/{org_id}/contacts", response_model=List[Contact])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def list_contacts(
    request: Request,
    org_id: UUID,
    status: ContactStatus | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: SupabaseUser = Depends(get_current_user),
):
    """List an organization's contacts.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to list contacts for.
        status: Optional lifecycle status to filter by.
        limit: Max number of contacts to return (1-500).
        user: The authenticated Supabase user.

    Returns:
        List[Contact]: The organization's contacts.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        query = client.table("contacts").select("*").eq("org_id", str(org_id))
        if status is not None:
            query = query.eq("status", status)
        response = await execute_query(query.order("created_at", desc=True).limit(limit))
        return [Contact(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_contacts_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/organizations/{org_id}/contacts", response_model=Contact)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def create_contact(
    request: Request, org_id: UUID, body: CreateContactRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Add a contact to an organization's recall list.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to add the contact to.
        body: The contact to create.
        user: The authenticated Supabase user.

    Returns:
        Contact: The created contact.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        payload = body.model_dump(exclude_none=True, mode="json")
        response = await execute_query(client.table("contacts").insert({**payload, "org_id": str(org_id)}))
        logger.info("contact_created", org_id=str(org_id), user_id=str(user.id))
        return Contact(**response.data[0])
    except APIError as e:
        logger.exception("create_contact_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/organizations/{org_id}/contacts/{contact_id}", response_model=Contact)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def get_contact(
    request: Request, org_id: UUID, contact_id: UUID, user: SupabaseUser = Depends(get_current_user)
):
    """Get a contact by ID.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the contact belongs to.
        contact_id: The ID of the contact to retrieve.
        user: The authenticated Supabase user.

    Returns:
        Contact: The requested contact.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        response = await execute_query(
            client.table("contacts").select("*").eq("id", str(contact_id)).eq("org_id", str(org_id)).single()
        )
        return Contact(**response.data)
    except APIError as e:
        logger.warning("contact_not_found", contact_id=str(contact_id), error=e.message)
        raise HTTPException(status_code=404, detail="Contact not found")


@router.patch("/organizations/{org_id}/contacts/{contact_id}", response_model=Contact)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def update_contact(
    request: Request,
    org_id: UUID,
    contact_id: UUID,
    body: UpdateContactRequest,
    user: SupabaseUser = Depends(get_current_user),
):
    """Update a contact.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the contact belongs to.
        contact_id: The ID of the contact to update.
        body: The fields to update.
        user: The authenticated Supabase user.

    Returns:
        Contact: The updated contact.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        payload = body.model_dump(exclude_none=True, mode="json")
        response = await execute_query(
            client.table("contacts").update(payload).eq("id", str(contact_id)).eq("org_id", str(org_id))
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Contact not found")

        logger.info("contact_updated", org_id=str(org_id), contact_id=str(contact_id))
        return Contact(**response.data[0])
    except APIError as e:
        logger.exception("update_contact_failed", contact_id=str(contact_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.delete("/organizations/{org_id}/contacts/{contact_id}")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def delete_contact(
    request: Request, org_id: UUID, contact_id: UUID, user: SupabaseUser = Depends(get_current_user)
):
    """Delete a contact.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the contact belongs to.
        contact_id: The ID of the contact to delete.
        user: The authenticated Supabase user.

    Returns:
        dict: A message confirming deletion.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        await execute_query(client.table("contacts").delete().eq("id", str(contact_id)).eq("org_id", str(org_id)))
        logger.info("contact_deleted", org_id=str(org_id), contact_id=str(contact_id))
        return {"message": "Contact deleted successfully"}
    except APIError as e:
        logger.exception("delete_contact_failed", contact_id=str(contact_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/organizations/{org_id}/contacts/{contact_id}/timeline", response_model=List[TimelineEntry])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def get_contact_timeline(
    request: Request,
    org_id: UUID,
    contact_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    user: SupabaseUser = Depends(get_current_user),
):
    """Get a contact's merged signal/task/interaction timeline, most recent first.

    Reads the `contact_timeline` view (see `supabase/migrations/0006_interactions.sql`),
    which unions `signals`, `tasks`, and `interactions` for one contact.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the contact belongs to.
        contact_id: The contact to get the timeline for.
        limit: Max number of entries to return (1-500).
        user: The authenticated Supabase user.

    Returns:
        List[TimelineEntry]: The contact's timeline, most recent first.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        await execute_query(
            client.table("contacts").select("id").eq("id", str(contact_id)).eq("org_id", str(org_id)).single()
        )
    except APIError as e:
        logger.warning("contact_timeline_contact_not_found", contact_id=str(contact_id), error=e.message)
        raise HTTPException(status_code=404, detail="Contact not found")

    try:
        response = await execute_query(
            client.table("contact_timeline")
            .select("*")
            .eq("contact_id", str(contact_id))
            .order("occurred_at", desc=True)
            .limit(limit)
        )
        return [TimelineEntry(**row) for row in response.data]
    except APIError as e:
        logger.exception("contact_timeline_failed", contact_id=str(contact_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
