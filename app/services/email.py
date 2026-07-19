"""Outbound email via an org's connected Google (Gmail) account.

Companion to ``app/services/calendar.py``: both sit between the Google HTTP
client (``clients/google_client.py``) and the callers that need it (the
internal voice endpoints), and both read the same per-org OAuth credential —
one connection powers calendar booking and email confirmation alike.

:func:`send_org_email` loads the org's stored refresh token, mints a fresh
access token, and sends a plain-text email as the connected mailbox through the
Gmail API. Requires the ``gmail.send`` scope on the refresh token; an org that
connected before that scope was added must reconnect Google once.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.logging import logger
from app.services.calendar import CalendarNotConnectedError, load_org_google_credential
from app.services.clients.google_client import refresh_access_token, send_gmail

# Re-exported so callers can catch a name that reads right for email, without a
# second exception type: a missing Google credential is the same condition for
# calendar and mail.
GoogleNotConnectedError = CalendarNotConnectedError


@dataclass(frozen=True)
class SentEmail:
    """Result of a successful send."""

    message_id: str
    thread_id: str | None


def build_meeting_confirmation_email(
    *,
    company_name: str,
    when_label: str,
    location: str | None = None,
) -> tuple[str, str]:
    """Compose the confirmation email sent the moment a meeting is booked.

    Pure (no I/O, no clock) so it is unit-testable and safe to call from the
    booking endpoint. The wording is deterministic — the confirmation is a
    built-in side effect of booking, not an LLM-authored message.

    Args:
        company_name: The organization's display name.
        when_label: Spoken-friendly meeting time (from ``format_slot_label``).
        location: Meeting location, when known.

    Returns:
        tuple[str, str]: The email subject and plain-text body.
    """
    where = f" at {location}" if location else ""
    subject = f"Your meeting with {company_name} is confirmed"
    body = (
        f"Your meeting with {company_name} is confirmed for {when_label}{where}.\n\n"
        f"We look forward to seeing you. Reply to this email if you need to make a change."
    )
    return subject, body


def build_post_meeting_email(
    *,
    company_name: str,
    when_label: str,
    location: str | None = None,
) -> tuple[str, str]:
    """Compose the follow-up email sent after a meeting's scheduled end time.

    Pure (no I/O, no clock) so it is unit-testable and safe to compose inside
    the durable follow-up task. Delivered by ``activities.channels.send_post_meeting_email``
    when the Temporal timer scheduled at meeting-end fires.

    Args:
        company_name: The organization's display name.
        when_label: Spoken-friendly meeting time (from ``format_slot_label``).
        location: Meeting location, when known.

    Returns:
        tuple[str, str]: The email subject and plain-text body.
    """
    where = f" at {location}" if location else ""
    subject = f"Thanks for meeting with {company_name}"
    body = (
        f"Thank you for meeting with {company_name} for your {when_label}{where} appointment.\n\n"
        f"We hope it went well. Reply to this email with any questions or to set up a next step, "
        f"and we will be glad to help."
    )
    return subject, body


async def send_org_email(
    *,
    org_id: str,
    to: str,
    subject: str,
    body: str,
) -> SentEmail:
    """Send a plain-text email from an org's connected Google account.

    Args:
        org_id: The organization whose connected mailbox sends the email.
        to: Recipient email address.
        subject: Email subject line.
        body: Plain-text email body.

    Returns:
        SentEmail: The Gmail message id and thread id.

    Raises:
        GoogleNotConnectedError: If the org has not connected Google.
    """
    credential = await load_org_google_credential(org_id)
    access_token = await refresh_access_token(credential.refresh_token)
    sent = await send_gmail(access_token, to=to, subject=subject, body=body)
    message_id = str(sent.get("id"))
    logger.info("org_email_sent", org_id=org_id, message_id=message_id)
    return SentEmail(message_id=message_id, thread_id=sent.get("threadId"))
