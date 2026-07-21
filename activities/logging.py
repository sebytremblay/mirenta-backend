"""Persist interaction logs, emit the interaction_result signal that closes the loop."""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel
from temporalio import activity

from app.core.config import settings
from app.core.logging import logger
from app.schemas.signals import Signal
from app.services.clients.supabase_client import execute_query, get_service_role_client
from app.services.clients.temporal_client import get_temporal_client
from workflows.contact_loop import ContactLoopWorkflow
from workflows.models import ContactLoopInput, SignalEnvelope


class LogInteractionInput(BaseModel):
    """Arguments to `log_interaction`."""

    org_id: str
    contact_id: str
    task_id: str | None = None
    channel: str
    direction: str
    agent_graph: str | None = None
    transcript: list[dict[str, Any]]
    outcome: str | None = None
    summary: str | None = None
    provider_ref: str | None = None
    guardrail_flags: list[dict[str, Any]] = []


@activity.defn
async def log_interaction(input: LogInteractionInput) -> str:
    """Insert one row into `interactions`; return the new interaction id."""
    client = await get_service_role_client()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "org_id": input.org_id,
        "contact_id": input.contact_id,
        "task_id": input.task_id,
        "channel": input.channel,
        "direction": input.direction,
        "agent_graph": input.agent_graph,
        "transcript": input.transcript,
        "outcome": input.outcome,
        "summary": input.summary,
        "provider_ref": input.provider_ref,
        "guardrail_flags": input.guardrail_flags,
        "started_at": now,
        "ended_at": now,
    }
    response = await execute_query(client.table("interactions").insert(row))
    return response.data[0]["id"]


class EmitInteractionResultSignalInput(BaseModel):
    """Arguments to `emit_interaction_result_signal`."""

    org_id: str
    contact_id: str
    interaction_id: str
    channel: str
    outcome: str | None = None
    summary: str | None = None
    task_goal: str | None = None


@activity.defn
async def emit_interaction_result_signal(input: EmitInteractionResultSignalInput) -> str:
    """Insert a new `interaction_result` signal and deliver it to the contact's workflow.

    Backfills `interactions.result_signal_id` and delivers the signal via
    Temporal signal-with-start (same pattern as `receive_twilio_sms`) rather
    than signaling an existing handle — a call from a brand-new contact has
    no `ContactLoopWorkflow` running yet when the interaction ends, so a
    plain `.signal()` on a handle would raise "workflow not found."
    Signal-with-start is a no-op start when the workflow is already running,
    so this is strictly more robust for every channel, not a voice-only
    branch.

    Closes the loop in `docs/architecture.md`.
    """
    client = await get_service_role_client()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "org_id": input.org_id,
        "contact_id": input.contact_id,
        "type": "interaction_result",
        "source": "system",
        "payload": {
            "interaction_id": input.interaction_id,
            "outcome": input.outcome,
            "summary": input.summary,
            "task_goal": input.task_goal,
        },
        "received_at": now,
        "delivered_at": now,
    }
    response = await execute_query(client.table("signals").insert(row))
    signal = Signal(**response.data[0])

    await execute_query(
        client.table("interactions").update({"result_signal_id": str(signal.id)}).eq("id", input.interaction_id)
    )

    temporal_client = await get_temporal_client()
    await temporal_client.start_workflow(
        ContactLoopWorkflow.run,
        ContactLoopInput(contact_id=input.contact_id, org_id=input.org_id),
        id=f"contact-loop:{input.contact_id}",
        task_queue=settings.TEMPORAL_TASK_QUEUE,
        start_signal="signal_received",
        start_signal_args=[SignalEnvelope(signal=signal, channel=input.channel)],
    )
    logger.info("interaction_result_signal_emitted", contact_id=input.contact_id, signal_id=str(signal.id))
    return str(signal.id)


class EmitMeetingScheduledSignalInput(BaseModel):
    """Arguments to `emit_meeting_scheduled_signal`."""

    org_id: str
    contact_id: str
    meeting_start: str
    meeting_end: str
    meeting_location: str | None = None
    recipient_email: str | None = None
    event_id: str | None = None


@activity.defn
async def emit_meeting_scheduled_signal(input: EmitMeetingScheduledSignalInput) -> str:
    """Insert a `meeting_scheduled` signal and deliver it to the contact's workflow.

    Emitted after the voice agent books a tour (`app/api/routers/voice.py`).
    The decision engine (`decide_on_meeting_scheduled`) reads `meeting_end` off
    the payload to schedule a post-meeting SMS follow-up. Delivered via Temporal
    signal-with-start for the same reason as `emit_interaction_result_signal`:
    the caller may have no `ContactLoopWorkflow` running yet.
    """
    client = await get_service_role_client()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "org_id": input.org_id,
        "contact_id": input.contact_id,
        "type": "meeting_scheduled",
        "channel": "voice",
        "source": "system",
        "payload": {
            "meeting_start": input.meeting_start,
            "meeting_end": input.meeting_end,
            "meeting_location": input.meeting_location,
            "recipient_email": input.recipient_email,
            "event_id": input.event_id,
        },
        "received_at": now,
        "delivered_at": now,
    }
    response = await execute_query(client.table("signals").insert(row))
    signal = Signal(**response.data[0])

    temporal_client = await get_temporal_client()
    await temporal_client.start_workflow(
        ContactLoopWorkflow.run,
        ContactLoopInput(contact_id=input.contact_id, org_id=input.org_id),
        id=f"contact-loop:{input.contact_id}",
        task_queue=settings.TEMPORAL_TASK_QUEUE,
        start_signal="signal_received",
        start_signal_args=[SignalEnvelope(signal=signal, channel="sms")],
    )
    logger.info("meeting_scheduled_signal_emitted", contact_id=input.contact_id, signal_id=str(signal.id))
    return str(signal.id)
