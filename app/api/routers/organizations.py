"""Organization and organization-membership endpoints for the API.

Authorization for these routes comes from Postgres Row Level Security, not
from manual checks here — each request is made with the calling user's
forwarded Supabase JWT (`get_user_client`), so the `is_org_member`/
`is_org_admin` policies (see `docs/database.md`) decide what's visible or
editable.
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

from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.organizations import MemberRole, Organization, OrganizationMember
from app.services.supabase_client import execute_query, get_user_client

router = APIRouter()


class CreateOrganizationRequest(BaseModel):
    """Request body for creating an organization."""

    name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=100)
    website_url: str | None = None
    phone: str | None = None
    timezone: str = "America/Los_Angeles"


class UpdateOrganizationRequest(BaseModel):
    """Request body for updating an organization."""

    name: str | None = Field(default=None, max_length=200)
    website_url: str | None = None
    phone: str | None = None
    timezone: str | None = None


class AddMemberRequest(BaseModel):
    """Request body for adding a member to an organization."""

    user_id: UUID
    role: MemberRole = "member"


@router.post("/organizations", response_model=Organization)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["organizations"][0])
async def create_organization(
    request: Request, body: CreateOrganizationRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Create a new organization and add the caller as its owner.

    Args:
        request: The FastAPI request object for rate limiting.
        body: The organization to create.
        user: The authenticated Supabase user.

    Returns:
        Organization: The created organization.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("organizations").insert(body.model_dump(exclude_none=True)))
        organization = Organization(**response.data[0])

        await execute_query(
            client.table("organization_members").insert(
                {"org_id": str(organization.id), "user_id": str(user.id), "role": "owner"}
            )
        )

        logger.info("organization_created", org_id=str(organization.id), user_id=str(user.id))
        return organization
    except APIError as e:
        logger.exception("organization_creation_failed", error=e.message, user_id=str(user.id))
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/organizations/{org_id}", response_model=Organization)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["organizations"][0])
async def get_organization(request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """Get an organization by ID.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The ID of the organization to retrieve.
        user: The authenticated Supabase user.

    Returns:
        Organization: The organization, if the caller is a member.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("organizations").select("*").eq("id", str(org_id)).single())
        return Organization(**response.data)
    except APIError as e:
        logger.warning("organization_not_found", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=404, detail="Organization not found")


@router.patch("/organizations/{org_id}", response_model=Organization)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["organizations"][0])
async def update_organization(
    request: Request, org_id: UUID, body: UpdateOrganizationRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Update an organization. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The ID of the organization to update.
        body: The fields to update.
        user: The authenticated Supabase user.

    Returns:
        Organization: The updated organization.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("organizations").update(body.model_dump(exclude_none=True)).eq("id", str(org_id))
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Organization not found or not permitted")

        logger.info("organization_updated", org_id=str(org_id), user_id=str(user.id))
        return Organization(**response.data[0])
    except APIError as e:
        logger.exception("organization_update_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/organizations/{org_id}/members", response_model=List[OrganizationMember])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["organizations"][0])
async def list_organization_members(request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """List an organization's members.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The ID of the organization.
        user: The authenticated Supabase user.

    Returns:
        List[OrganizationMember]: The organization's members.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("organization_members").select("*").eq("org_id", str(org_id)))
        return [OrganizationMember(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_organization_members_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/organizations/{org_id}/members", response_model=OrganizationMember)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["organizations"][0])
async def add_organization_member(
    request: Request, org_id: UUID, body: AddMemberRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Add a member to an organization. Requires the caller to be an org admin.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The ID of the organization.
        body: The member to add.
        user: The authenticated Supabase user.

    Returns:
        OrganizationMember: The created membership.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(
            client.table("organization_members").insert(
                {"org_id": str(org_id), "user_id": str(body.user_id), "role": body.role}
            )
        )
        logger.info("organization_member_added", org_id=str(org_id), user_id=str(body.user_id), role=body.role)
        return OrganizationMember(**response.data[0])
    except APIError as e:
        logger.exception("add_organization_member_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
