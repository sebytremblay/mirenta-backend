"""SMS org/contact resolution and the STOP/START compliance fast-path.

`app/api/routers/signals.py` parses the inbound Twilio webhook, resolves
the org/contact via this module, then either handles a STOP/START keyword
synchronously here (no LLM, no scheduling — must ack within the request) or
hands the signal off to `ContactLoopWorkflow` (Temporal) for everything
else. The LLM-reply path itself lives in `activities/interactions.py`,
invoked from `workflows/task_execution.py`.
"""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.api.twilio_utils import load_org_twilio_auth_token
from app.core.logging import logger
from app.services.clients.supabase_client import execute_query
from app.services.clients.twilio_client import send_sms

# TCPA opt-out/opt-in keywords (case-insensitive, exact match on the whole
# body) — handled deterministically, never routed through the LLM.
SMS_STOP_KEYWORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit"}
SMS_START_KEYWORDS = {"start", "unstop", "yes"}


async def find_org_by_phone(client: Any, phone: str) -> dict[str, Any] | None:
    """Resolve the organization whose Twilio number (`organizations.phone`) received the message.

    `organizations.phone` is unique when set (see migration 0012). Returns
    Twilio SIDs needed for outbound replies and webhook signature checks.
    """
    response = await execute_query(
        client.table("organizations")
        .select("id, phone, twilio_subaccount_sid, twilio_messaging_service_sid")
        .eq("phone", phone)
        .limit(1)
    )
    return response.data[0] if response.data else None


async def _find_contact_by_phone(client: Any, org_id: str, phone: str) -> dict[str, Any] | None:
    """Resolve the contact a message came from, scoped to the resolved org.

    Selects the full row (not just `id`): the voice webhook needs the full
    `Contact` to run `decision.guardrails.check_dnc` synchronously before
    answering a call, and this lookup is shared with SMS.
    """
    response = await execute_query(
        client.table("contacts").select("*").eq("org_id", org_id).eq("phone", phone).limit(1)
    )
    return response.data[0] if response.data else None


async def get_or_create_contact_by_phone(client: Any, org_id: str, phone: str) -> dict[str, Any]:
    """Resolve the contact a message came from, auto-creating a bare one on first contact.

    Inbound texts from numbers not already on the org's recall list still
    get a reply (and somewhere for consent to attach to) rather than being
    dropped.
    """
    contact = await _find_contact_by_phone(client, org_id, phone)
    if contact:
        return contact
    response = await execute_query(client.table("contacts").insert({"org_id": org_id, "phone": phone}))
    logger.info("contact_auto_created_from_sms", org_id=org_id, phone=phone)
    return response.data[0]


async def _record_sms_consent(client: Any, org_id: str, contact_id: str, granted: bool) -> None:
    """Append a consent decision from an SMS STOP/START reply (never update in place)."""
    await execute_query(
        client.table("consent").insert(
            {
                "org_id": org_id,
                "contact_id": contact_id,
                "channel": "sms",
                "granted": granted,
                "source": "sms_reply",
            }
        )
    )


async def _log_interaction(
    client: Any,
    *,
    org_id: str,
    contact_id: str,
    inbound_body: str,
    reply_body: str | None,
    message_sid: str | None,
    agent_graph: str | None,
) -> UUID:
    """Log one inbound-SMS turn to `interactions`, for the contact timeline."""
    transcript: list[dict[str, str]] = [{"role": "human", "content": inbound_body}]
    if reply_body:
        transcript.append({"role": "ai", "content": reply_body})
    now = datetime.now(timezone.utc).isoformat()
    response = await execute_query(
        client.table("interactions").insert(
            {
                "org_id": org_id,
                "contact_id": contact_id,
                "channel": "sms",
                "direction": "inbound",
                "agent_graph": agent_graph,
                "transcript": transcript,
                "provider_ref": message_sid,
                "started_at": now,
                "ended_at": now,
            }
        )
    )
    return UUID(response.data[0]["id"])


async def handle_sms_keyword_fastpath(
    client: Any,
    *,
    org_id: str,
    contact_id: str,
    body: str,
    from_number: str,
    to_number: str,
    message_sid: str | None,
    messaging_service_sid: str | None = None,
    subaccount_sid: str | None = None,
) -> bool:
    """Handle an inbound SMS if it's a STOP/START compliance keyword.

    This is a webhook-level short-circuit, not part of the Signal -> Decision
    -> Task -> Interaction loop: it never creates a `Task`, never touches an
    LLM, and acks within the webhook request instead of via a scheduled task
    (an opt-out confirmation shouldn't wait on Temporal scheduling latency).

    Returns:
        True if the message was a keyword and was fully handled (the caller
        should stop here); False otherwise (the caller should hand the
        signal off to `ContactLoopWorkflow`).
    """
    normalized = body.strip().lower()

    auth_token: str | None = None
    if subaccount_sid:
        auth_token = await load_org_twilio_auth_token(client, org_id)

    if normalized in SMS_STOP_KEYWORDS:
        await _record_sms_consent(client, org_id, contact_id, granted=False)
        reply = "You've been unsubscribed and won't receive further messages. Reply START to resubscribe."
        await send_sms(
            to=from_number,
            from_=to_number,
            body=reply,
            messaging_service_sid=messaging_service_sid,
            subaccount_sid=subaccount_sid,
            auth_token=auth_token,
        )
        await _log_interaction(
            client,
            org_id=org_id,
            contact_id=contact_id,
            inbound_body=body,
            reply_body=reply,
            message_sid=message_sid,
            agent_graph=None,
        )
        return True

    if normalized in SMS_START_KEYWORDS:
        await _record_sms_consent(client, org_id, contact_id, granted=True)
        reply = "You're resubscribed. Reply STOP at any time to opt out."
        await send_sms(
            to=from_number,
            from_=to_number,
            body=reply,
            messaging_service_sid=messaging_service_sid,
            subaccount_sid=subaccount_sid,
            auth_token=auth_token,
        )
        await _log_interaction(
            client,
            org_id=org_id,
            contact_id=contact_id,
            inbound_body=body,
            reply_body=reply,
            message_sid=message_sid,
            agent_graph=None,
        )
        return True

    return False
