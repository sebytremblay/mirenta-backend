"""This file contains the appointment schema for the application (Supabase `appointments` table)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse

AppointmentStatus = Literal["booked", "kept", "no_show", "cancelled", "rescheduled"]


class Appointment(BaseResponse):
    """The billable outcome of an outreach conversation. `kept` is the event you invoice on.

    Attributes:
        id: Appointment ID.
        org_id: The organization this appointment belongs to.
        conversation_id: The conversation that led to this booking, if any.
        contact_id: The contact this appointment is for.
        starts_at: When the appointment starts.
        status: The appointment's current status.
        created_at: When the appointment was created.
        updated_at: When the appointment was last updated.
    """

    id: UUID = Field(..., description="Appointment ID")
    org_id: UUID = Field(..., description="The organization this appointment belongs to")
    conversation_id: UUID | None = Field(default=None, description="The conversation that led to this booking, if any")
    contact_id: UUID = Field(..., description="The contact this appointment is for")
    starts_at: datetime = Field(..., description="When the appointment starts")
    status: AppointmentStatus = Field(default="booked", description="The appointment's current status")
    created_at: datetime = Field(..., description="When the appointment was created")
    updated_at: datetime = Field(..., description="When the appointment was last updated")
