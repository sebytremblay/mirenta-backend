"""Inbound voice call ingestion + the live Media Stream bridge.

Kept separate from `signals.py` (which is scoped to `Signal` CRUD/ingestion
with a uniform `Signal`-returning contract): this router additionally owns a
stateful `WebSocket` route with a completely different lifecycle (long-lived,
no `Signal` response body).

`POST /webhooks/twilio/voice` resolves DNC + consent synchronously and
answers the call directly — it deliberately does NOT route the `inbound_call`
signal through `decision.engine.evaluate`. Quiet-hours/frequency-cap
guardrails gate outbound-*initiated* outreach, not answering an inbound
call, and a webhook only has a few seconds to respond with TwiML, which
rules out going through Temporal/the decision engine the way SMS replies do.
The `inbound_call` signal is still recorded for audit/timeline purposes; see
`docs/architecture.md`.
"""

from typing import Any

from fastapi import APIRouter, Request, Response, WebSocket
from postgrest.exceptions import APIError

from activities.contact_store import GetConsentInput, get_current_consent
from app.api.twilio_utils import mark_signal_status, validate_twilio_signature
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.contacts import Contact
from app.schemas.signals import Signal
from app.services.sms_interaction import find_org_by_phone, get_or_create_contact_by_phone
from app.services.clients.supabase_client import execute_query, get_service_role_client
from app.services.clients.twilio_client import generate_voice_answer_twiml, generate_voice_reject_twiml
from app.services.runtimes.voice_runtime import VoiceCallSession
from decision.guardrails import check_consent, check_dnc

router = APIRouter()

UNIQUE_VIOLATION = "23505"


def _voice_stream_url(request: Request, call_sid: str) -> str:
    """Build the `wss://` Media Stream URL for one call, proxy/ngrok-safe.

    Mirrors `public_request_url`'s `X-Forwarded-Proto`/`X-Forwarded-Host`
    handling rather than trusting `settings.APP_BASE_URL`, which can drift
    from an active ngrok tunnel in local development.
    """
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.url.netloc)
    ws_scheme = "wss" if proto == "https" else "ws"
    base_path = request.url.path.rsplit("/webhooks/twilio/voice", 1)[0]
    return f"{ws_scheme}://{host}{base_path}/ws/twilio/voice/{call_sid}"


@router.post("/webhooks/twilio/voice")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["voice_webhook"][0])
async def receive_twilio_call(request: Request):
    """Answer an inbound call, or reject it if DNC/consent blocks it.

    Verifies Twilio's request signature the same way `receive_twilio_sms`
    does, resolves org/contact, runs DNC + consent checks synchronously
    (not the full `run_hard_guardrails` — see module docstring), records an
    `inbound_call` signal for audit/timeline, and returns TwiML.

    Args:
        request: The raw Twilio webhook request (form-encoded).

    Returns:
        Response: A TwiML XML document instructing Twilio how to handle the call.
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

    await mark_signal_status(client, str(signal.id), "processed")
    stream_url = _voice_stream_url(request, call_sid)
    twiml = generate_voice_answer_twiml(
        stream_url=stream_url, org_id=str(org["id"]), contact_id=str(contact.id), signal_id=str(signal.id)
    )
    return Response(content=twiml, media_type="application/xml")


@router.websocket("/ws/twilio/voice/{call_sid}")
async def voice_media_stream(websocket: WebSocket, call_sid: str) -> None:
    """Bridge one Twilio Media Stream connection for the duration of a call.

    No `@limiter.limit` here: slowapi only instruments HTTP routes, not
    WebSocket ASGI scopes -- a deliberate, documented exception to AGENTS.md's
    "all routes must have rate limiting" rule. `VoiceCallSession` validates
    `start.callSid` against this path and (see `deepgram_client.py`) the
    call is bounded by Deepgram's own connection lifecycle; a dedicated
    `VOICE_MAX_CALL_SECONDS` watchdog is noted as follow-up work.

    Args:
        websocket: The upgraded Twilio Media Stream WebSocket connection.
        call_sid: The Twilio Call SID from the TwiML `<Stream>` URL path.
    """
    session = VoiceCallSession(websocket=websocket, call_sid=call_sid)
    await session.run()
