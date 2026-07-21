"""Raw channel sends: sms and email today; voice/webhook are future work."""

from datetime import datetime

from pydantic import BaseModel
from temporalio import activity

from app.api.twilio_utils import load_org_twilio_auth_token
from app.core.config import settings
from app.core.logging import logger
from app.services.calendar import format_slot_label
from app.services.clients.supabase_client import get_service_role_client
from app.services.clients.twilio_client import send_sms
from app.services.email import GoogleNotConnectedError, build_post_meeting_email, send_org_email


class SendSmsInput(BaseModel):
    """Arguments to `send_sms_message`."""

    to: str
    body: str
    from_: str | None = None
    messaging_service_sid: str | None = None
    subaccount_sid: str | None = None
    org_id: str | None = None


class SendSmsResult(BaseModel):
    """Result of `send_sms_message`."""

    message_sid: str


@activity.defn
async def send_sms_message(input: SendSmsInput) -> SendSmsResult:
    """Send one SMS via Twilio and return its message SID."""
    auth_token: str | None = None
    if input.subaccount_sid and input.org_id:
        client = await get_service_role_client()
        auth_token = await load_org_twilio_auth_token(client, input.org_id)

    message_sid = await send_sms(
        to=input.to,
        from_=input.from_,
        body=input.body,
        messaging_service_sid=input.messaging_service_sid,
        subaccount_sid=input.subaccount_sid,
        auth_token=auth_token,
    )
    return SendSmsResult(message_sid=message_sid)


class SendPostMeetingEmailInput(BaseModel):
    """Arguments to `send_post_meeting_email`.

    ``recipient_email`` is the customer's address captured live on the call and
    threaded through the meeting_scheduled signal. It is intentionally *not*
    backfilled from ``contacts.email``: the contact row is the realtor/org, not
    the caller, so a fallback there would email the wrong party. A missing
    recipient yields a clean ``sent=False`` rather than a misdirected send.
    """

    org_id: str
    contact_id: str
    company_name: str
    recipient_email: str | None = None
    meeting_start: str | None = None
    meeting_location: str | None = None


class SendPostMeetingEmailResult(BaseModel):
    """Result of `send_post_meeting_email`.

    ``sent`` is False (not an error) when the org has not connected Google or
    no customer email was captured on the call, so the durable follow-up task
    completes cleanly rather than exhausting its retries on a permanent condition.
    """

    sent: bool
    connected: bool
    to: str | None = None
    message_id: str | None = None


def _meeting_label(meeting_start: str | None) -> str:
    """Render a spoken-friendly label for the meeting start, tolerant of gaps."""
    if not meeting_start:
        return "recent appointment"
    try:
        return format_slot_label(datetime.fromisoformat(meeting_start))
    except ValueError:
        return "recent appointment"


@activity.defn
async def send_post_meeting_email(input: SendPostMeetingEmailInput) -> SendPostMeetingEmailResult:
    """Compose and send the post-meeting follow-up email at meeting-end.

    Sends to ``input.recipient_email`` — the customer's address captured on the
    call, not the contact row (which is the realtor/org). Composes a
    deterministic thank-you (no LLM — this mirrors the built-in confirmation
    email) and sends it from the org's connected Google account. Returns
    ``sent=False`` (not an error) when no recipient was captured or the org has
    not connected Google, so the Temporal task does not retry a permanent
    condition. Transient Google failures still raise so the activity's retry
    policy can take over.
    """
    recipient = input.recipient_email.strip() if input.recipient_email else None
    if not recipient:
        logger.info("post_meeting_email_skipped_no_recipient", contact_id=input.contact_id)
        return SendPostMeetingEmailResult(sent=False, connected=True, to=None)

    company_name = input.company_name or settings.DEFAULT_PERSONA_NAME
    subject, body = build_post_meeting_email(
        company_name=company_name,
        when_label=_meeting_label(input.meeting_start),
        location=input.meeting_location,
    )
    try:
        sent = await send_org_email(org_id=input.org_id, to=recipient, subject=subject, body=body)
    except GoogleNotConnectedError:
        logger.info("post_meeting_email_not_connected", org_id=input.org_id)
        return SendPostMeetingEmailResult(sent=False, connected=False, to=recipient)
    logger.info("post_meeting_email_sent", org_id=input.org_id, contact_id=input.contact_id)
    return SendPostMeetingEmailResult(sent=True, connected=True, to=recipient, message_id=sent.message_id)
