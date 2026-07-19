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
