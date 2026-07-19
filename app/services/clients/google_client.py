"""Google OAuth + Calendar REST client.

Talks to Google's OAuth2 and Calendar v3 HTTP endpoints directly with ``httpx``
rather than pulling in ``google-api-python-client`` — the surface we need
(token exchange, silent refresh, free/busy, event insert) is a handful of REST
calls, and staying SDK-free keeps the dependency set small.

Realtors connect once via OAuth; we persist only the refresh token (Fernet
encrypted, in ``organization_google_credentials``). Every calendar call mints a
fresh access token from that refresh token, so the realtor never re-auths.

This module is a thin client: no Supabase reads/writes and no slot math live
here (see ``app/services/calendar.py`` and the OAuth router). It owns exactly
the Google HTTP contract and token encryption.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.logging import logger

# OAuth2 + Calendar v3 endpoints.
GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
GOOGLE_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1"

# access_type=offline + prompt=consent is what makes Google return a refresh
# token (and re-issue one on re-consent) — without it a re-auth yields only an
# access token and the "no manual refresh" guarantee breaks.
OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

_HTTP_TIMEOUT = 30.0


@dataclass(frozen=True)
class GoogleTokens:
    """Tokens returned by an OAuth code exchange."""

    access_token: str
    refresh_token: str | None
    scope: str | None
    expires_in: int | None
    email: str | None


@dataclass(frozen=True)
class BusyBlock:
    """A single busy interval from a free/busy query (RFC3339 strings)."""

    start: str
    end: str


def _fernet() -> Fernet:
    """Fernet helper for Google refresh-token encryption at rest.

    Requires ``GOOGLE_TOKEN_ENCRYPTION_KEY`` (url-safe base64, 32 bytes). Unlike
    the Twilio helper there is no derived-key fallback: a Google refresh token is
    long-lived and cross-account, so it must never be encrypted under an
    implicitly derived key.
    """
    raw = settings.GOOGLE_TOKEN_ENCRYPTION_KEY.strip()
    if not raw:
        raise RuntimeError("GOOGLE_TOKEN_ENCRYPTION_KEY is required to store Google refresh tokens")
    return Fernet(raw.encode("utf-8"))


def encrypt_refresh_token(refresh_token: str) -> str:
    """Encrypt a Google refresh token for ``organization_google_credentials``."""
    return _fernet().encrypt(refresh_token.encode("utf-8")).decode("utf-8")


def decrypt_refresh_token(encrypted: str) -> str:
    """Decrypt a refresh token previously stored by :func:`encrypt_refresh_token`."""
    try:
        return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken as e:
        raise RuntimeError("failed to decrypt google refresh token — check GOOGLE_TOKEN_ENCRYPTION_KEY") from e


def build_authorize_url(state: str) -> str:
    """Build the Google consent URL the realtor is redirected to.

    Args:
        state: Signed, opaque value round-tripped to the callback (carries the
            org id + CSRF protection). Verified by the OAuth router.

    Returns:
        str: The full ``accounts.google.com`` authorize URL.
    """
    query = urlencode(
        {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(OAUTH_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
    )
    return f"{GOOGLE_AUTH_URI}?{query}"


def _is_transient_http_error(exc: BaseException) -> bool:
    """Retry only on network faults and Google 5xx — never on 4xx (bad grant)."""
    if isinstance(exc, (httpx.ConnectError, httpx.TimeoutException)):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500


async def exchange_code(code: str) -> GoogleTokens:
    """Exchange an authorization code for tokens (first-consent path).

    Args:
        code: The ``code`` query param Google sent to the callback.

    Returns:
        GoogleTokens: Access token plus the refresh token to persist. The
        refresh token may be ``None`` if the user previously consented without a
        revoke — the router treats that as an error worth surfacing.
    """
    data = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    payload = await _post_token(data)
    email = await _fetch_email(payload["access_token"])
    return GoogleTokens(
        access_token=payload["access_token"],
        refresh_token=payload.get("refresh_token"),
        scope=payload.get("scope"),
        expires_in=payload.get("expires_in"),
        email=email,
    )


async def refresh_access_token(refresh_token: str) -> str:
    """Mint a fresh access token from a stored refresh token.

    This is the durability path proven out before build: no human involved.

    Args:
        refresh_token: The decrypted refresh token.

    Returns:
        str: A short-lived access token for calendar calls.
    """
    data = {
        "refresh_token": refresh_token,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "grant_type": "refresh_token",
    }
    payload = await _post_token(data)
    return payload["access_token"]


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_http_error),
    reraise=True,
)
async def _post_token(data: dict[str, str]) -> dict[str, Any]:
    """POST to Google's token endpoint, retrying transient failures only."""
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.post(GOOGLE_TOKEN_URI, data=data)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            logger.exception("google_token_request_failed", status=response.status_code)
            raise
        return response.json()


async def _fetch_email(access_token: str) -> str | None:
    """Best-effort fetch of the connected Google account email (for display)."""
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            response = await client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json().get("email")
    except httpx.HTTPError:
        logger.warning("google_userinfo_fetch_failed")
        return None


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_http_error),
    reraise=True,
)
async def query_free_busy(
    access_token: str,
    *,
    calendar_id: str,
    time_min: datetime,
    time_max: datetime,
) -> list[BusyBlock]:
    """Return busy intervals for a calendar over ``[time_min, time_max]``.

    Args:
        access_token: A fresh access token (from :func:`refresh_access_token`).
        calendar_id: The Google calendar id (usually ``"primary"``).
        time_min: Window start (timezone-aware).
        time_max: Window end (timezone-aware).

    Returns:
        list[BusyBlock]: Busy blocks; empty when the calendar is free.
    """
    body = {
        "timeMin": time_min.isoformat(),
        "timeMax": time_max.isoformat(),
        "items": [{"id": calendar_id}],
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.post(
            f"{GOOGLE_CALENDAR_BASE}/freeBusy",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            logger.exception("google_free_busy_failed", status=response.status_code, calendar_id=calendar_id)
            raise
        calendars = response.json().get("calendars", {})
        busy = calendars.get(calendar_id, {}).get("busy", [])
        return [BusyBlock(start=b["start"], end=b["end"]) for b in busy]


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_http_error),
    reraise=True,
)
async def insert_event(
    access_token: str,
    *,
    calendar_id: str,
    summary: str,
    start: datetime,
    end: datetime,
    timezone: str,
    location: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Create a calendar event and return the Google event resource.

    Args:
        access_token: A fresh access token.
        calendar_id: The Google calendar id (usually ``"primary"``).
        summary: Event title.
        start: Event start (timezone-aware).
        end: Event end (timezone-aware).
        timezone: IANA timezone name for the event times.
        location: Optional event location (the property address).
        description: Optional event description.

    Returns:
        dict: The created event resource (includes ``id`` and ``htmlLink``).
    """
    body: dict[str, Any] = {
        "summary": summary,
        "start": {"dateTime": start.isoformat(), "timeZone": timezone},
        "end": {"dateTime": end.isoformat(), "timeZone": timezone},
    }
    if location:
        body["location"] = location
    if description:
        body["description"] = description

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.post(
            f"{GOOGLE_CALENDAR_BASE}/calendars/{calendar_id}/events",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            logger.exception("google_event_insert_failed", status=response.status_code, calendar_id=calendar_id)
            raise
        return response.json()


def _build_raw_message(*, sender: str | None, to: str, subject: str, body: str) -> str:
    """Encode a plain-text email as Gmail's base64url ``raw`` payload.

    Gmail's ``messages/send`` takes an RFC 2822 message, base64url-encoded. We
    build a minimal text/plain message; ``From`` is optional because Gmail sends
    as the authenticated account when it is omitted.

    Args:
        sender: ``From`` address, or ``None`` to let Gmail use the account's own.
        to: Recipient email address.
        subject: Email subject line.
        body: Plain-text email body.

    Returns:
        str: The base64url-encoded MIME message.
    """
    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    if sender:
        message["From"] = sender
    message.set_content(body)
    return base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_http_error),
    reraise=True,
)
async def send_gmail(
    access_token: str,
    *,
    to: str,
    subject: str,
    body: str,
    sender: str | None = None,
) -> dict[str, Any]:
    """Send a plain-text email as the connected Google account.

    Uses the Gmail v3 ``users/me/messages/send`` endpoint, so the message is
    sent from whichever account authorized the token (the org's connected
    mailbox). Requires the ``gmail.send`` OAuth scope on the refresh token.

    Args:
        access_token: A fresh access token (from :func:`refresh_access_token`).
        to: Recipient email address.
        subject: Email subject line.
        body: Plain-text email body.
        sender: Optional explicit ``From`` address; defaults to the account's own.

    Returns:
        dict: The sent-message resource (includes ``id`` and ``threadId``).
    """
    raw = _build_raw_message(sender=sender, to=to, subject=subject, body=body)
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.post(
            f"{GOOGLE_GMAIL_BASE}/users/me/messages/send",
            headers={"Authorization": f"Bearer {access_token}"},
            json={"raw": raw},
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            logger.exception("google_gmail_send_failed", status=response.status_code)
            raise
        return response.json()
