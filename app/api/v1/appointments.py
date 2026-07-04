"""Appointment endpoints for the API.

Authorization comes from Postgres Row Level Security via the caller's
forwarded Supabase JWT — org members can read; status transitions (e.g.
marking an appointment `kept`) are a dashboard action gated the same way.
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
from pydantic import BaseModel

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.appointments import Appointment, AppointmentStatus
from app.schemas.auth import SupabaseUser
from app.services.supabase_client import execute_query, get_user_client

router = APIRouter()


class UpdateAppointmentRequest(BaseModel):
    """Request body for updating an appointment's status or time."""

    starts_at: datetime | None = None
    status: AppointmentStatus | None = None


@router.get("/organizations/{org_id}/appointments", response_model=List[Appointment])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["appointments"][0])
async def list_appointments(request: Request, org_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """List an organization's appointments.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to list appointments for.
        user: The authenticated Supabase user.

    Returns:
        List[Appointment]: The organization's appointments.
    """
    client = await get_user_client(user.access_token)
    try:
        response = await execute_query(client.table("appointments").select("*").eq("org_id", str(org_id)))
        return [Appointment(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_appointments_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.patch("/appointments/{appointment_id}", response_model=Appointment)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["appointments"][0])
async def update_appointment(
    request: Request,
    appointment_id: UUID,
    body: UpdateAppointmentRequest,
    user: SupabaseUser = Depends(get_current_user),
):
    """Update an appointment's status or scheduled time.

    Args:
        request: The FastAPI request object for rate limiting.
        appointment_id: The ID of the appointment to update.
        body: The fields to update.
        user: The authenticated Supabase user.

    Returns:
        Appointment: The updated appointment.
    """
    client = await get_user_client(user.access_token)
    try:
        payload = body.model_dump(exclude_none=True, mode="json")
        response = await execute_query(
            client.table("appointments").update(payload).eq("id", str(appointment_id))
        )
        if not response.data:
            raise HTTPException(status_code=404, detail="Appointment not found or not permitted")

        logger.info("appointment_updated", appointment_id=str(appointment_id), status=body.status)
        return Appointment(**response.data[0])
    except APIError as e:
        logger.exception("update_appointment_failed", appointment_id=str(appointment_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)
