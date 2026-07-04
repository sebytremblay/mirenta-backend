"""Contact (recall list) endpoints for the API.

Authorization comes from Postgres Row Level Security via the caller's
forwarded Supabase JWT — org members can read, org admins can manage.
"""

from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)
from postgrest.exceptions import APIError
from pydantic import BaseModel, EmailStr

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.contacts import Contact
from app.services.supabase_client import execute_query, get_user_client

router = APIRouter()


class CreateContactRequest(BaseModel):
    """Request body for adding a contact to a clinic's recall list."""

    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None


class UpdateContactRequest(BaseModel):
    """Request body for updating a contact."""

    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    last_seen_at: datetime | None = None
    opted_out_at: datetime | None = None


@router.get("/organizations/{org_id}/contacts", response_model=List[Contact])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def list_contacts(request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """List an organization's contacts.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to list contacts for.
        user: The authenticated Supabase user.

    Returns:
        List[Contact]: The organization's contacts.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("contacts").select("*").eq("org_id", str(org_id)))
        return [Contact(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_contacts_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/organizations/{org_id}/contacts", response_model=Contact)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def create_contact(
    request: Request, org_id: UUID, body: CreateContactRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Add a contact to an organization's recall list. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to add the contact to.
        body: The contact to create.
        user: The authenticated Supabase user.

    Returns:
        Contact: The created contact.
    """
    client = await get_user_client(user.access_token)
    try:
        payload = body.model_dump(exclude_none=True, mode="json")
        response = await execute_query(client.table("contacts").insert({**payload, "org_id": str(org_id)}))
        logger.info("contact_created", org_id=str(org_id), user_id=str(user.id))
        return Contact(**response.data[0])
    except APIError as e:
        logger.exception("create_contact_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.patch("/organizations/{org_id}/contacts/{contact_id}", response_model=Contact)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["contacts"][0])
async def update_contact(
    request: Request,
    org_id: UUID,
    contact_id: UUID,
    body: UpdateContactRequest,
    user: SupabaseUser = Depends(get_current_user),
):
    """Update a contact. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the contact belongs to.
        contact_id: The ID of the contact to update.
        body: The fields to update.
        user: The authenticated Supabase user.

    Returns:
        Contact: The updated contact.
    """
    client = await get_user_client(user.access_token)
    try:
        payload = body.model_dump(exclude_none=True, mode="json")
        response = await execute_query(
            client.table("contacts").update(payload).eq("id", str(contact_id)).eq("org_id", str(org_id))
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Contact not found or not permitted")

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
    """Delete a contact. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the contact belongs to.
        contact_id: The ID of the contact to delete.
        user: The authenticated Supabase user.

    Returns:
        dict: A message confirming deletion.
    """
    client = await get_user_client(user.access_token)
    try:
        await execute_query(client.table("contacts").delete().eq("id", str(contact_id)).eq("org_id", str(org_id)))
        logger.info("contact_deleted", org_id=str(org_id), contact_id=str(contact_id))
        return {"message": "Contact deleted successfully"}
    except APIError as e:
        logger.exception("delete_contact_failed", contact_id=str(contact_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
