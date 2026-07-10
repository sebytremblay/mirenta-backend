"""Persist interaction logs, emit the interaction_result signal that closes the loop."""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel
from temporalio import activity

from app.core.logging import logger
from app.schemas.signals import Signal
from app.services.supabase_client import execute_query, get_service_role_client
from app.services.temporal_client import get_temporal_client
from workflows.models import SignalEnvelope


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
    outcome: str | None = None
    summary: str | None = None


@activity.defn
async def emit_interaction_result_signal(input: EmitInteractionResultSignalInput) -> str:
    """Insert a new `interaction_result` signal and deliver it to the contact's workflow.

    Backfills `interactions.result_signal_id` and signals the contact's own
    `ContactLoopWorkflow` — the "logged result -> new Signal" step that
    closes the loop in `docs/architecture.md`.
    """
    client = await get_service_role_client()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "org_id": input.org_id,
        "contact_id": input.contact_id,
        "type": "interaction_result",
        "source": "system",
        "payload": {"interaction_id": input.interaction_id, "outcome": input.outcome, "summary": input.summary},
        "received_at": now,
        "delivered_at": now,
    }
    response = await execute_query(client.table("signals").insert(row))
    signal = Signal(**response.data[0])

    await execute_query(
        client.table("interactions").update({"result_signal_id": str(signal.id)}).eq("id", input.interaction_id)
    )

    temporal_client = await get_temporal_client()
    handle = temporal_client.get_workflow_handle(f"contact-loop:{input.contact_id}")
    await handle.signal("signal_received", SignalEnvelope(signal=signal, channel="sms"))
    logger.info("interaction_result_signal_emitted", contact_id=input.contact_id, signal_id=str(signal.id))
    return str(signal.id)
