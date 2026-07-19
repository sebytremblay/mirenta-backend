"""Raw channel sends: sms and email today; voice/webhook are future work."""

from datetime import datetime

from pydantic import BaseModel
from temporalio import activity

from app.api.twilio_utils import load_org_twilio_auth_token
from app.core.config import settings
from app.core.logging import logger
from app.services.calendar import format_slot_label
from app.services.clients.supabase_client import execute_query, get_service_role_client
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
    """Arguments to `send_post_meeting_email`."""

    org_id: str
    contact_id: str
    company_name: str
    meeting_start: str | None = None
    meeting_location: str | None = None


class SendPostMeetingEmailResult(BaseModel):
    """Result of `send_post_meeting_email`.

    ``sent`` is False (not an error) when the org has not connected Google or
    the contact has no email on file, so the durable follow-up task completes
    cleanly rather than exhausting its retries on a permanent condition.
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

    Loads the contact's email on file, composes a deterministic thank-you (no
    LLM — this mirrors the built-in confirmation email), and sends it from the
    org's connected Google account. Returns ``sent=False`` (not an error) when
    the contact has no email or the org has not connected Google, so the Temporal
    task does not retry a permanent condition. Transient Google failures still
    raise so the activity's retry policy can take over.
    """
    client = await get_service_role_client()
    response = await execute_query(
        client.table("contacts").select("email").eq("id", input.contact_id).maybe_single()
    )
    row = getattr(response, "data", None)
    recipient = (row or {}).get("email")
    recipient = str(recipient).strip() if recipient else None
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
