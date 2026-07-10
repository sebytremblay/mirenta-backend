"""Signal-ingestion endpoints for the API.

Signals are the single entry point for the Takeoff Runtime agent loop — see
`docs/architecture.md`. Every inbound webhook, dashboard-triggered manual
signal, and `interaction_result` re-entry lands in the `signals` table via
this router. `signals` is locked to the service role (no RLS policies —
see `docs/database.md#row-level-security`), so dashboard-facing endpoints
here authorize via `assert_org_member` and then read/write through
`get_service_role_client()`.

`inbound_sms` is the one signal type with real routing today:
`receive_twilio_sms` handles STOP/START keywords synchronously (see
`app.services.sms_interaction.handle_sms_keyword_fastpath`) and hands
everything else off to the contact's `ContactLoopWorkflow` via Temporal
signal-with-start, which runs the decision engine and, from there, the
full task -> interaction loop.
"""

from datetime import datetime, timezone
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
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator

from app.api.deps import assert_org_member
from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.schemas.contacts import Channel
from app.schemas.signals import Signal, SignalType
from app.services.sms_interaction import (
    find_org_by_phone,
    get_or_create_contact_by_phone,
    handle_sms_keyword_fastpath,
)
from app.services.supabase_client import execute_query, get_service_role_client
from app.services.temporal_client import get_temporal_client
from workflows.contact_loop import ContactLoopWorkflow
from workflows.models import ContactLoopInput, SignalEnvelope

router = APIRouter()

UNIQUE_VIOLATION = "23505"


class CreateSignalRequest(BaseModel):
    """Request body for manually injecting a signal (operator/dashboard-triggered)."""

    contact_id: UUID | None = None
    type: SignalType = "manual"
    channel: Channel | None = None
    source: str = "operator"
    payload: dict[str, Any] = Field(default_factory=dict)


def _public_request_url(request: Request) -> str:
    """Reconstruct the externally-visible URL Twilio signed the request against.

    Behind a TLS-terminating proxy, `request.url` reflects the proxy-to-app
    hop (often plain `http`), which would make every signature check fail —
    so prefer `X-Forwarded-Proto`/`X-Forwarded-Host` when present.
    """
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.url.netloc)
    query = f"?{request.url.query}" if request.url.query else ""
    return f"{proto}://{host}{request.url.path}{query}"


async def _mark_signal_status(client: Any, signal_id: str, status: str) -> None:
    await execute_query(
        client.table("signals")
        .update({"status": status, "processed_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", signal_id)
    )


@router.post("/webhooks/twilio/sms", response_model=Signal)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["sms_webhook"][0])
async def receive_twilio_sms(request: Request):
    """Receive an inbound SMS from Twilio, record it as a `Signal`, and route it.

    Verifies Twilio's request signature (`X-Twilio-Signature`) against
    `TWILIO_AUTH_TOKEN` before trusting the payload — see
    https://www.twilio.com/docs/usage/security#validating-requests. STOP/START
    keywords are handled synchronously (see
    `app.services.sms_interaction.handle_sms_keyword_fastpath`); everything
    else is handed to the contact's `ContactLoopWorkflow` via a Temporal
    signal-with-start, which runs the decision engine and, from there, the
    full task -> interaction loop.

    The `signals.dedup_key` unique constraint is the idempotency boundary:
    a replayed webhook for a message already recorded short-circuits before
    generating a second reply.

    Args:
        request: The raw Twilio webhook request (form-encoded).

    Returns:
        Signal: The recorded signal (or the existing one, if this is a
        replayed webhook for a message already seen).
    """
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}

    signature = request.headers.get("X-Twilio-Signature", "")
    validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)
    if not validator.validate(_public_request_url(request), params, signature):
        logger.warning("twilio_sms_signature_invalid", url=str(request.url))
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    from_number = params.get("From", "")
    to_number = params.get("To", "")
    message_sid = params.get("MessageSid") or None
    body = params.get("Body", "").strip()

    client = await get_service_role_client()

    org = await find_org_by_phone(client, to_number)
    if org is None:
        logger.warning("twilio_sms_org_not_found", to_number=to_number)
        raise HTTPException(status_code=404, detail="No organization is configured for this number")

    contact = await get_or_create_contact_by_phone(client, org["id"], from_number)

    row = {
        "org_id": org["id"],
        "contact_id": contact["id"],
        "type": "inbound_sms",
        "channel": "sms",
        "source": "twilio",
        "dedup_key": message_sid,
        "payload": {"from": from_number, "to": to_number, "body": body},
        "raw_payload": params,
    }

    try:
        response = await execute_query(client.table("signals").insert(row))
        signal = Signal(**response.data[0])
        logger.info("signal_received", type="inbound_sms", org_id=org["id"], contact_id=contact["id"])
    except APIError as e:
        if e.code == UNIQUE_VIOLATION:
            logger.info("twilio_sms_duplicate_ignored", message_sid=message_sid)
            existing = await execute_query(client.table("signals").select("*").eq("dedup_key", message_sid).single())
            return Signal(**existing.data)
        logger.exception("twilio_sms_signal_failed", error=e.message)
        raise HTTPException(status_code=400, detail=e.message)

    try:
        handled = await handle_sms_keyword_fastpath(
            client,
            org_id=org["id"],
            contact_id=contact["id"],
            body=body,
            from_number=from_number,
            to_number=to_number,
            message_sid=message_sid,
        )
        if handled:
            await _mark_signal_status(client, str(signal.id), "processed")
        else:
            temporal_client = await get_temporal_client()
            await temporal_client.start_workflow(
                ContactLoopWorkflow.run,
                ContactLoopInput(contact_id=str(contact["id"]), org_id=str(org["id"])),
                id=f"contact-loop:{contact['id']}",
                task_queue=settings.TEMPORAL_TASK_QUEUE,
                start_signal="signal_received",
                start_signal_args=[SignalEnvelope(signal=signal, channel="sms")],
            )
            # "delivered" (not "processed"): the decision engine hasn't
            # consumed this signal yet, it's just been handed to Temporal.
            # `activities/contact_store.mark_signal_processed` sets
            # status="processed"/processed_at once `ContactLoopWorkflow`
            # actually runs it through `decision.engine.evaluate`.
            await execute_query(
                client.table("signals")
                .update({"status": "delivered", "delivered_at": datetime.now(timezone.utc).isoformat()})
                .eq("id", str(signal.id))
            )
    except Exception:
        logger.exception("twilio_sms_signal_dispatch_failed", contact_id=contact["id"], message_sid=message_sid)
        await _mark_signal_status(client, str(signal.id), "failed")

    return signal


@router.post("/organizations/{org_id}/signals", response_model=Signal)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["signals"][0])
async def create_signal(
    request: Request, org_id: UUID, body: CreateSignalRequest, user: SupabaseUser = Depends(get_current_user)
):
    """Manually inject a signal for an organization (operator/dashboard-triggered).

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to inject the signal for.
        body: The signal to create.
        user: The authenticated Supabase user.

    Returns:
        Signal: The created signal.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        row = body.model_dump(mode="json", exclude_none=True)
        row["org_id"] = str(org_id)
        response = await execute_query(client.table("signals").insert(row))
        logger.info("signal_created", org_id=str(org_id), type=body.type, user_id=str(user.id))
        return Signal(**response.data[0])
    except APIError as e:
        logger.exception("create_signal_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/organizations/{org_id}/signals", response_model=List[Signal])
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["signals"][0])
async def list_signals(
    request: Request,
    org_id: UUID,
    contact_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: SupabaseUser = Depends(get_current_user),
):
    """List an organization's signals, most recent first.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization to list signals for.
        contact_id: Optional contact to filter by.
        limit: Max number of signals to return (1-200).
        user: The authenticated Supabase user.

    Returns:
        List[Signal]: The organization's signals, most recent first.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        query = client.table("signals").select("*").eq("org_id", str(org_id))
        if contact_id is not None:
            query = query.eq("contact_id", str(contact_id))
        response = await execute_query(query.order("received_at", desc=True).limit(limit))
        return [Signal(**row) for row in response.data]
    except APIError as e:
        logger.exception("list_signals_failed", org_id=str(org_id), error=e.message)
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/organizations/{org_id}/signals/{signal_id}", response_model=Signal)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["signals"][0])
async def get_signal(request: Request, org_id: UUID, signal_id: UUID, user: SupabaseUser = Depends(get_current_user)):
    """Get a single signal by ID.

    Args:
        request: The FastAPI request object for rate limiting.
        org_id: The organization the signal belongs to.
        signal_id: The ID of the signal to retrieve.
        user: The authenticated Supabase user.

    Returns:
        Signal: The requested signal.
    """
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    try:
        response = await execute_query(
            client.table("signals").select("*").eq("id", str(signal_id)).eq("org_id", str(org_id)).single()
        )
        return Signal(**response.data)
    except APIError as e:
        logger.warning("signal_not_found", signal_id=str(signal_id), error=e.message)
        raise HTTPException(status_code=404, detail="Signal not found")
