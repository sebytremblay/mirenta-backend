"""Read/write contact state, org lookups, signal/task rows — no LLM, no langgraph."""

from datetime import datetime, timezone
from typing import Any

from postgrest.exceptions import APIError
from pydantic import BaseModel
from temporalio import activity

from app.core.logging import logger
from app.schemas.contacts import Contact, ContactState, CurrentConsent
from app.schemas.organizations import Organization
from app.schemas.tasks import Task
from app.services.clients.supabase_client import execute_query, get_service_role_client
from decision.models import ProposedTask

UNIQUE_VIOLATION = "23505"


@activity.defn
async def get_contact(contact_id: str) -> Contact:
    """Fetch a contact by ID."""
    client = await get_service_role_client()
    response = await execute_query(client.table("contacts").select("*").eq("id", contact_id).single())
    return Contact(**response.data)


@activity.defn
async def get_organization(org_id: str) -> Organization:
    """Fetch an organization by ID."""
    client = await get_service_role_client()
    response = await execute_query(client.table("organizations").select("*").eq("id", org_id).single())
    return Organization(**response.data)


class GetOrCreateContactStateInput(BaseModel):
    """Arguments to `get_or_create_contact_state`."""

    contact_id: str
    org_id: str


@activity.defn
async def get_or_create_contact_state(input: GetOrCreateContactStateInput) -> ContactState:
    """Fetch a contact's state, auto-creating a bare row on first signal.

    `contact_state` has no default-insert trigger; this mirrors
    `get_or_create_contact_by_phone`'s auto-create pattern.
    """
    client = await get_service_role_client()
    response = await execute_query(
        client.table("contact_state").select("*").eq("contact_id", input.contact_id).maybe_single()
    )
    if response and response.data:
        return ContactState(**response.data)
    response = await execute_query(
        client.table("contact_state").insert({"contact_id": input.contact_id, "org_id": input.org_id})
    )
    logger.info("contact_state_auto_created", contact_id=input.contact_id, org_id=input.org_id)
    return ContactState(**response.data[0])


class GetConsentInput(BaseModel):
    """Arguments to `get_current_consent`."""

    contact_id: str
    channel: str


@activity.defn
async def get_current_consent(input: GetConsentInput) -> CurrentConsent | None:
    """Fetch the latest consent decision for a contact/channel, if any."""
    client = await get_service_role_client()
    response = await execute_query(
        client.table("current_consent")
        .select("*")
        .eq("contact_id", input.contact_id)
        .eq("channel", input.channel)
        .maybe_single()
    )
    if response and response.data:
        return CurrentConsent(**response.data)
    return None


class UpdateContactStateInput(BaseModel):
    """Arguments to `update_contact_state`."""

    contact_id: str
    patch: dict[str, Any]


@activity.defn
async def update_contact_state(input: UpdateContactStateInput) -> None:
    """Apply a `decision.engine.DecisionOutput.contact_state_patch`."""
    if not input.patch:
        return
    client = await get_service_role_client()
    await execute_query(client.table("contact_state").update(input.patch).eq("contact_id", input.contact_id))


class SetContactWorkflowIdInput(BaseModel):
    """Arguments to `set_contact_workflow_id`."""

    contact_id: str
    workflow_id: str


@activity.defn
async def set_contact_workflow_id(input: SetContactWorkflowIdInput) -> None:
    """Record `contact_state.temporal_workflow_id`, called once at `ContactLoopWorkflow` startup."""
    client = await get_service_role_client()
    await execute_query(
        client.table("contact_state")
        .update({"temporal_workflow_id": input.workflow_id})
        .eq("contact_id", input.contact_id)
    )


class InsertTaskInput(BaseModel):
    """Arguments to `insert_task`."""

    org_id: str
    contact_id: str
    caused_by_signal_id: str
    proposed: ProposedTask


@activity.defn
async def insert_task(input: InsertTaskInput) -> Task:
    """Insert one row from a `decision.engine.ProposedTask`.

    Relies on the `tasks.idempotency_key` unique constraint
    (`0005_tasks.sql`) — on a duplicate, fetches and returns the existing
    row instead of raising, exactly like `receive_twilio_sms`'s
    `dedup_key` handling in `app/api/routers/signals.py`.
    """
    client = await get_service_role_client()
    row = {
        "org_id": input.org_id,
        "contact_id": input.contact_id,
        "caused_by_signal_id": input.caused_by_signal_id,
        "type": input.proposed.type,
        "idempotency_key": input.proposed.idempotency_key,
        "scheduled_for": input.proposed.scheduled_for.isoformat(),
        "payload": input.proposed.payload,
    }
    try:
        response = await execute_query(client.table("tasks").insert(row))
        return Task(**response.data[0])
    except APIError as e:
        if e.code == UNIQUE_VIOLATION:
            logger.info("task_idempotency_duplicate_ignored", idempotency_key=input.proposed.idempotency_key)
            existing = await execute_query(
                client.table("tasks").select("*").eq("idempotency_key", input.proposed.idempotency_key).single()
            )
            return Task(**existing.data)
        raise


@activity.defn
async def get_task(task_id: str) -> Task:
    """Fetch a task by ID."""
    client = await get_service_role_client()
    response = await execute_query(client.table("tasks").select("*").eq("id", task_id).single())
    return Task(**response.data)


class UpdateTaskStatusInput(BaseModel):
    """Arguments to `update_task_status`."""

    task_id: str
    status: str
    guardrail_result: dict[str, Any] | None = None
    error: str | None = None
    mark_started: bool = False
    mark_completed: bool = False


@activity.defn
async def update_task_status(input: UpdateTaskStatusInput) -> None:
    """Update a task's status, guardrail result, and started/completed timestamps."""
    client = await get_service_role_client()
    patch: dict[str, Any] = {"status": input.status}
    if input.guardrail_result is not None:
        patch["guardrail_result"] = input.guardrail_result
    if input.error is not None:
        patch["error"] = input.error
    now = datetime.now(timezone.utc).isoformat()
    if input.mark_started:
        patch["started_at"] = now
    if input.mark_completed:
        patch["completed_at"] = now
    await execute_query(client.table("tasks").update(patch).eq("id", input.task_id))


@activity.defn
async def mark_signal_processed(signal_id: str) -> None:
    """Set `signals.status='processed'`/`processed_at`.

    Called once the decision engine has actually consumed the signal (see
    `Signal.processed_at`'s docstring), as opposed to `delivered_at`, which
    the webhook router sets the moment the signal is merely handed to
    Temporal.
    """
    client = await get_service_role_client()
    await execute_query(
        client.table("signals")
        .update({"status": "processed", "processed_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", signal_id)
    )


class CancelScheduledFollowUpsInput(BaseModel):
    """Arguments to `cancel_scheduled_follow_ups`."""

    contact_id: str
    goal: str = "follow_up_no_response"


@activity.defn
async def cancel_scheduled_follow_ups(input: CancelScheduledFollowUpsInput) -> int:
    """Mark still-scheduled follow-up SMS tasks for a contact as canceled.

    The matching `TaskExecutionWorkflow` re-reads status after its sleep and
    exits without sending — see `workflows/task_execution.py`.
    """
    client = await get_service_role_client()
    response = await execute_query(
        client.table("tasks")
        .update({"status": "canceled"})
        .eq("contact_id", input.contact_id)
        .eq("status", "scheduled")
        .eq("type", "sms")
        .contains("payload", {"goal": input.goal})
        .select("id")
    )
    canceled = len(response.data or [])
    if canceled:
        logger.info(
            "scheduled_follow_ups_canceled",
            contact_id=input.contact_id,
            canceled_count=canceled,
            goal=input.goal,
        )
    return canceled
