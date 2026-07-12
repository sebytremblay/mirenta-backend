"""Voice endpoints: Twilio inbound webhook + LiveKit agent bridge.

`POST /webhooks/twilio/voice` is the voice webhook set on newly provisioned
org numbers (alongside the SMS webhook). It records an `inbound_call` signal,
then — when `settings.LIVEKIT_SIP_URI` is configured — dials the call into
the LiveKit SIP trunk with Mirenta correlation ids as custom SIP headers, so
the already-dispatched `mirenta-voice` agent can bootstrap the session. Falls
back to reject TwiML when the SIP bridge isn't configured, or when the call
is blocked/invalid.

`POST /internal/voice/bootstrap` and `POST /internal/voice/finalize` are
called by the LiveKit Cloud agent worker (shared secret) for both SIP calls
and WebRTC / console sessions that supply Mirenta correlation metadata.
"""

import secrets
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from postgrest.exceptions import APIError

from activities.contact_store import GetConsentInput, get_current_consent
from activities.logging import (
    EmitInteractionResultSignalInput,
    LogInteractionInput,
    emit_interaction_result_signal,
    log_interaction,
)
from app.api.twilio_utils import mark_signal_status, validate_twilio_signature
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.core.prompts import load_voice_greeting, load_voice_prompt
from app.schemas.contacts import Contact
from app.schemas.signals import Signal
from app.schemas.voice import (
    VoiceSessionBootstrapRequest,
    VoiceSessionBootstrapResponse,
    VoiceSessionFinalizeRequest,
    VoiceSessionFinalizeResponse,
)
from app.services.clients.supabase_client import execute_query, get_service_role_client
from app.services.clients.twilio_client import generate_voice_dial_twiml, generate_voice_reject_twiml
from app.services.knowledge import fetch_active_knowledge, format_knowledge_for_prompt
from app.services.sms_interaction import find_org_by_phone, get_or_create_contact_by_phone
from decision.guardrails import check_consent, check_dnc

router = APIRouter()

UNIQUE_VIOLATION = "23505"


def _require_internal_api_key(x_mirenta_internal_key: str | None) -> None:
    """Reject LiveKit agent callbacks that lack the shared internal API key."""
    expected = settings.MIRENTA_INTERNAL_API_KEY
    if not expected or not x_mirenta_internal_key or not secrets.compare_digest(x_mirenta_internal_key, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_internal_api_key")


@router.post("/webhooks/twilio/voice")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["voice_webhook"][0])
async def receive_twilio_call(request: Request):
    """Bridge inbound Twilio voice calls into the LiveKit voice agent.

    Verifies Twilio's request signature, resolves org/contact, records an
    `inbound_call` signal for audit, and — when a LiveKit SIP trunk is
    configured — dials the call into it with Mirenta correlation ids as SIP
    headers. New org numbers are provisioned with this webhook as `voice_url`.

    Args:
        request: The raw Twilio webhook request (form-encoded).

    Returns:
        Response: TwiML that either dials into the LiveKit SIP trunk or
        speaks a message and hangs up.
    """
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}

    from_number = params.get("From", "")
    to_number = params.get("To", "")
    call_sid = params.get("CallSid") or ""

    client = await get_service_role_client()

    org = await find_org_by_phone(client, to_number)
    if not await validate_twilio_signature(request, params, client, org_id=org["id"] if org else None):
        logger.warning("twilio_voice_signature_invalid", url=str(request.url), to_number=to_number)
        return Response(
            content=generate_voice_reject_twiml(message="We are unable to take your call."),
            media_type="application/xml",
            status_code=403,
        )
    if org is None:
        logger.warning("twilio_voice_org_not_found", to_number=to_number)
        return Response(
            content=generate_voice_reject_twiml(message="We are unable to take your call."),
            media_type="application/xml",
            status_code=404,
        )

    contact_row = await get_or_create_contact_by_phone(client, org["id"], from_number)
    contact = Contact(**contact_row)

    row: dict[str, Any] = {
        "org_id": org["id"],
        "contact_id": str(contact.id),
        "type": "inbound_call",
        "channel": "voice",
        "source": "twilio",
        "dedup_key": call_sid or None,
        "payload": {"from": from_number, "to": to_number},
        "raw_payload": params,
    }

    try:
        response = await execute_query(client.table("signals").insert(row))
        signal = Signal(**response.data[0])
        logger.info("signal_received", type="inbound_call", org_id=org["id"], contact_id=str(contact.id))
    except APIError as e:
        if e.code == UNIQUE_VIOLATION:
            logger.info("twilio_voice_duplicate_ignored", call_sid=call_sid)
            existing = await execute_query(client.table("signals").select("*").eq("dedup_key", call_sid).single())
            signal = Signal(**existing.data)
        else:
            logger.exception("twilio_voice_signal_failed", error=e.message)
            return Response(
                content=generate_voice_reject_twiml(message="We are unable to take your call."),
                media_type="application/xml",
                status_code=500,
            )

    denial = check_dnc(contact)
    if denial is None:
        consent = await get_current_consent(GetConsentInput(contact_id=str(contact.id), channel="voice"))
        denial = check_consent(consent, "voice")

    if denial is not None:
        logger.info("twilio_voice_call_blocked", call_sid=call_sid, check=denial.check, detail=denial.detail)
        await mark_signal_status(client, str(signal.id), "ignored")
        return Response(
            content=generate_voice_reject_twiml(message="We are unable to take your call at this time."),
            media_type="application/xml",
        )

    if not settings.LIVEKIT_SIP_URI:
        logger.warning("twilio_voice_sip_bridge_not_configured", call_sid=call_sid, org_id=org["id"])
        await mark_signal_status(client, str(signal.id), "ignored")
        return Response(
            content=generate_voice_reject_twiml(message="We are unable to take your call."),
            media_type="application/xml",
        )

    logger.info("twilio_voice_dialed_to_livekit", call_sid=call_sid, org_id=org["id"])
    await mark_signal_status(client, str(signal.id), "delivered")
    return Response(
        content=generate_voice_dial_twiml(
            sip_uri=settings.LIVEKIT_SIP_URI,
            headers={
                "X-Mirenta-Org-Id": org["id"],
                "X-Mirenta-Contact-Id": str(contact.id),
                "X-Mirenta-Signal-Id": str(signal.id),
                "X-Mirenta-Call-Sid": call_sid,
            },
        ),
        media_type="application/xml",
    )


@router.post("/internal/voice/bootstrap", response_model=VoiceSessionBootstrapResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["voice_internal"][0])
async def bootstrap_voice_session(
    request: Request,
    body: VoiceSessionBootstrapRequest,
    x_mirenta_internal_key: str | None = Header(default=None),
) -> VoiceSessionBootstrapResponse:
    """Return persona + knowledge instructions for the LiveKit agent.

    Args:
        request: FastAPI request (required by slowapi).
        body: Call correlation ids from LiveKit room metadata.
        x_mirenta_internal_key: Shared secret from the LiveKit Cloud agent.

    Returns:
        VoiceSessionBootstrapResponse: Instructions and greeting for the session.
    """
    _ = request
    _require_internal_api_key(x_mirenta_internal_key)
    client = await get_service_role_client()
    org = await execute_query(client.table("organizations").select("name").eq("id", str(body.org_id)).single())
    company_name = str(org.data.get("name") or settings.DEFAULT_PERSONA_NAME)
    entries = await fetch_active_knowledge(body.org_id)
    knowledge = format_knowledge_for_prompt(entries)
    return VoiceSessionBootstrapResponse(
        org_id=body.org_id,
        contact_id=body.contact_id,
        signal_id=body.signal_id,
        call_sid=body.call_sid,
        persona_name=settings.DEFAULT_PERSONA_NAME,
        greeting=load_voice_greeting(company_name=company_name),
        instructions=load_voice_prompt(persona=settings.DEFAULT_PERSONA_NAME, knowledge=knowledge),
        knowledge=knowledge,
    )


@router.post("/internal/voice/finalize", response_model=VoiceSessionFinalizeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["voice_internal"][0])
async def finalize_voice_session(
    request: Request,
    body: VoiceSessionFinalizeRequest,
    x_mirenta_internal_key: str | None = Header(default=None),
) -> VoiceSessionFinalizeResponse:
    """Log the finished call and re-enter ContactLoopWorkflow.

    Args:
        request: FastAPI request (required by slowapi).
        body: Transcript + outcome from the LiveKit agent session close hook.
        x_mirenta_internal_key: Shared secret from the LiveKit Cloud agent.

    Returns:
        VoiceSessionFinalizeResponse: Interaction and result-signal ids.
    """
    _ = request
    _require_internal_api_key(x_mirenta_internal_key)

    outcome = body.outcome or ("progressed" if body.transcript else "no_answer")
    interaction_id = await log_interaction(
        LogInteractionInput(
            org_id=body.org_id,
            contact_id=body.contact_id,
            task_id=None,
            channel="voice",
            direction="inbound",
            agent_graph="livekit_voice_agent",
            transcript=body.transcript,
            outcome=outcome,
            summary=body.summary,
            provider_ref=body.call_sid,
        )
    )
    result_signal_id = await emit_interaction_result_signal(
        EmitInteractionResultSignalInput(
            org_id=body.org_id,
            contact_id=body.contact_id,
            interaction_id=interaction_id,
            channel="voice",
            outcome=outcome,
            summary=body.summary,
        )
    )
    logger.info(
        "voice_session_finalized",
        call_sid=body.call_sid,
        interaction_id=interaction_id,
        signal_id=result_signal_id,
        outcome=outcome,
    )
    return VoiceSessionFinalizeResponse(interaction_id=interaction_id, signal_id=result_signal_id)
