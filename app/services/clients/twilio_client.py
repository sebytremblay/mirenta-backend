"""This file contains the Twilio client factory and outbound-messaging/provisioning helpers.

ISV pattern (Twilio architecture type #1): each Mirenta org gets its own
Twilio subaccount, a US local number purchased in that subaccount, and a
Messaging Service that owns inbound SMS webhook routing. Subaccount API
calls authenticate with that subaccount's own SID + Auth Token (parent
SID+token with an `account_sid` override can 401 on some resources). The
subaccount Auth Token is stored encrypted for webhook signature checks and
outbound sends.
"""

from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from twilio.base import values
from twilio.base.exceptions import TwilioRestException
from twilio.http.async_http_client import AsyncTwilioHttpClient
from twilio.rest import Client
from twilio.twiml.voice_response import Connect, Stream, VoiceResponse
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.logging import logger

_parent_client: Client | None = None
_http_client: AsyncTwilioHttpClient | None = None


def _async_http_client() -> AsyncTwilioHttpClient:
    """Shared async HTTP client so we don't leak aiohttp sessions per Client."""
    global _http_client
    if _http_client is None:
        _http_client = AsyncTwilioHttpClient()
    return _http_client


def get_twilio_client(*, account_sid: str | None = None, auth_token: str | None = None) -> Client:
    """Twilio REST client for the parent account or a specific subaccount.

    Uses `AsyncTwilioHttpClient` so callers can safely use `*_async` methods
    from FastAPI/Temporal async paths.

    When both `account_sid` and `auth_token` are provided, authenticates as
    that account directly (required for subaccounts). Parent SID + parent
    token with only an `account_sid` override is not used for subaccounts —
    it can return Twilio 20003/401 on resources like AvailablePhoneNumbers.

    Args:
        account_sid: Optional account/subaccount SID.
        auth_token: Auth Token matching `account_sid`. Required when
            `account_sid` is a subaccount.

    Returns:
        Client: Authenticated Twilio client.
    """
    global _parent_client
    parent_sid = settings.TWILIO_ACCOUNT_SID
    parent_token = settings.TWILIO_AUTH_TOKEN
    http = _async_http_client()

    if account_sid and auth_token:
        return Client(account_sid, auth_token, http_client=http)

    if account_sid is None or account_sid == parent_sid:
        if _parent_client is None:
            _parent_client = Client(parent_sid, parent_token, http_client=http)
        return _parent_client

    # Subaccount SID without its own token: still prefer authenticating as
    # the subaccount is impossible — fall back to parent-scoped client and
    # log so misconfigured orgs are visible.
    logger.warning("twilio_subaccount_client_missing_auth_token", account_sid=account_sid)
    return Client(parent_sid, parent_token, account_sid, http_client=http)


def _fernet() -> Fernet:
    """Fernet helper for subaccount Auth Token encryption at rest.

    Prefer `TWILIO_TOKEN_ENCRYPTION_KEY` (url-safe base64-encoded 32 bytes).
    When unset, derive a stable key from the parent Auth Token so local dev
    works without an extra env var — rotate the explicit key in production.
    """
    raw = settings.TWILIO_TOKEN_ENCRYPTION_KEY.strip()
    if raw:
        return Fernet(raw.encode("utf-8"))
    if not settings.TWILIO_AUTH_TOKEN:
        raise RuntimeError("TWILIO_TOKEN_ENCRYPTION_KEY or TWILIO_AUTH_TOKEN is required to encrypt subaccount tokens")
    digest = hashlib.sha256(f"mirenta-twilio-token:{settings.TWILIO_AUTH_TOKEN}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_twilio_auth_token(auth_token: str) -> str:
    """Encrypt a Twilio Auth Token for storage in `organization_twilio_secrets`."""
    return _fernet().encrypt(auth_token.encode("utf-8")).decode("utf-8")


def decrypt_twilio_auth_token(encrypted: str) -> str:
    """Decrypt a token previously stored by `encrypt_twilio_auth_token`."""
    try:
        return _fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")
    except InvalidToken as e:
        raise RuntimeError("failed to decrypt twilio auth token — check TWILIO_TOKEN_ENCRYPTION_KEY") from e


def _is_transient_twilio_error(exc: BaseException) -> bool:
    """Whether a Twilio error is worth retrying (5xx) vs. a permanent 4xx rejection."""
    return isinstance(exc, TwilioRestException) and exc.status >= 500


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_twilio_error),
    reraise=True,
)
async def send_sms(
    *,
    to: str,
    body: str,
    from_: str | None = None,
    messaging_service_sid: str | None = None,
    subaccount_sid: str | None = None,
    auth_token: str | None = None,
) -> str:
    """Send an outbound SMS via Twilio, retrying on transient (5xx) failures.

    Prefer `messaging_service_sid` (ISV Messaging Service). Fall back to
    `from_` for legacy orgs that only have a phone number on the parent
    account. Does not retry on 4xx errors.

    Args:
        to: Destination phone number, E.164 format.
        body: Message text.
        from_: Sending organization's Twilio number (legacy path).
        messaging_service_sid: Org Messaging Service SID (preferred).
        subaccount_sid: Org Twilio subaccount SID; scopes the send.
        auth_token: Subaccount Auth Token (required with `subaccount_sid`).

    Returns:
        str: The Twilio message SID.
    """
    if not messaging_service_sid and not from_:
        raise ValueError("send_sms requires messaging_service_sid or from_")

    client = get_twilio_client(account_sid=subaccount_sid, auth_token=auth_token)
    try:
        if messaging_service_sid:
            message = await client.messages.create_async(
                to=to,
                messaging_service_sid=messaging_service_sid,
                body=body,
            )
        else:
            message = await client.messages.create_async(to=to, from_=from_, body=body)
    except TwilioRestException as e:
        logger.exception(
            "twilio_sms_send_failed",
            to=to,
            from_=from_,
            messaging_service_sid=messaging_service_sid,
            subaccount_sid=subaccount_sid,
            status=e.status,
            error=e.msg,
        )
        raise
    if message.sid is None:
        raise RuntimeError("twilio message create succeeded but returned no sid")
    logger.info(
        "twilio_sms_sent",
        to=to,
        from_=from_,
        messaging_service_sid=messaging_service_sid,
        subaccount_sid=subaccount_sid,
        message_sid=message.sid,
    )
    return message.sid


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_twilio_error),
    reraise=True,
)
async def _find_available_local_number(client: Client, area_code: str | None) -> str:
    """Search Twilio's US local-number inventory for one purchasable number.

    Read-only, so retrying on transient (5xx) failures is safe.

    Args:
        client: Twilio client scoped to the account that will buy the number.
        area_code: Optional 3-digit US area code to restrict the search to.

    Returns:
        str: An available number, E.164 format.

    Raises:
        RuntimeError: No number matched the search.
    """
    available = await client.available_phone_numbers("US").local.list_async(
        area_code=area_code or values.unset,
        sms_enabled=True,
        voice_enabled=True,
        limit=1,
    )
    if not available or available[0].phone_number is None:
        raise RuntimeError(f"no available twilio numbers found (area_code={area_code!r})")
    return available[0].phone_number


@dataclass(frozen=True)
class ProvisionedOrgTwilio:
    """Twilio resources created for one Mirenta organization."""

    phone_number: str
    subaccount_sid: str
    auth_token: str
    phone_sid: str
    messaging_service_sid: str


async def provision_org_twilio(
    *,
    org_id: str,
    friendly_name: str,
    area_code: str | None = None,
) -> ProvisionedOrgTwilio:
    """Create a subaccount, buy a US local number, and attach a Messaging Service.

    Not retried at create/purchase steps: a timed-out request that actually
    succeeded server-side would leak orphaned Twilio resources on retry.
    Only the read-only number search is safe to retry automatically.

    After the subaccount is created, all further API calls authenticate with
    that subaccount's own SID + Auth Token from the create response.

    Args:
        org_id: Mirenta organization UUID (used in Twilio friendly names).
        friendly_name: Human-readable label (usually the org name).
        area_code: Optional 3-digit US area code to search within.

    Returns:
        ProvisionedOrgTwilio: Phone + SIDs + plaintext Auth Token (caller
        must encrypt before persisting).
    """
    parent = get_twilio_client()
    label = f"mirenta:{org_id[:8]}:{friendly_name}"[:64]
    try:
        account = await parent.api.accounts.create_async(friendly_name=label)
    except TwilioRestException as e:
        logger.exception("twilio_subaccount_create_failed", org_id=org_id, status=e.status, error=e.msg)
        raise
    if account.sid is None or account.auth_token is None:
        raise RuntimeError("twilio subaccount create succeeded but returned no sid/auth_token")

    sub = get_twilio_client(account_sid=account.sid, auth_token=account.auth_token)
    sms_url = f"{settings.APP_BASE_URL}{settings.API_PREFIX}/webhooks/twilio/sms"
    voice_url = f"{settings.APP_BASE_URL}{settings.API_PREFIX}/webhooks/twilio/voice"

    phone_number = await _find_available_local_number(sub, area_code)
    try:
        purchased = await sub.incoming_phone_numbers.create_async(
            phone_number=phone_number,
            sms_url=sms_url,
            sms_method="POST",
            voice_url=voice_url,
            voice_method="POST",
            friendly_name=label,
        )
    except TwilioRestException as e:
        logger.exception(
            "twilio_number_purchase_failed",
            org_id=org_id,
            subaccount_sid=account.sid,
            phone_number=phone_number,
            status=e.status,
            error=e.msg,
        )
        raise
    if purchased.phone_number is None or purchased.sid is None:
        raise RuntimeError("twilio number purchase succeeded but returned no phone_number/sid")

    try:
        service = await sub.messaging.v1.services.create_async(
            friendly_name=label,
            inbound_request_url=sms_url,
            inbound_method="POST",
            usecase="customer_care",
        )
    except TwilioRestException as e:
        logger.exception(
            "twilio_messaging_service_create_failed",
            org_id=org_id,
            subaccount_sid=account.sid,
            status=e.status,
            error=e.msg,
        )
        raise
    if service.sid is None:
        raise RuntimeError("twilio messaging service create succeeded but returned no sid")

    try:
        await sub.messaging.v1.services(service.sid).phone_numbers.create_async(phone_number_sid=purchased.sid)
    except TwilioRestException as e:
        logger.exception(
            "twilio_messaging_service_attach_number_failed",
            org_id=org_id,
            messaging_service_sid=service.sid,
            phone_sid=purchased.sid,
            status=e.status,
            error=e.msg,
        )
        raise

    logger.info(
        "twilio_org_provisioned",
        org_id=org_id,
        phone_number=purchased.phone_number,
        subaccount_sid=account.sid,
        phone_sid=purchased.sid,
        messaging_service_sid=service.sid,
        sms_url=sms_url,
        voice_url=voice_url,
    )
    return ProvisionedOrgTwilio(
        phone_number=purchased.phone_number,
        subaccount_sid=account.sid,
        auth_token=account.auth_token,
        phone_sid=purchased.sid,
        messaging_service_sid=service.sid,
    )


def generate_voice_answer_twiml(*, stream_url: str, org_id: str, contact_id: str, signal_id: str) -> str:
    """Build TwiML that answers an inbound call with a bidirectional Media Stream.

    Uses <Connect><Stream> rather than <Start><Stream>: <Connect> hands full
    call control to the stream (so we can send synthesized audio back over
    the same socket), whereas <Start><Stream> is a read-only parallel fork
    typically paired with <Dial>/<Say> that cannot receive audio back.
    Correlation context travels as <Parameter> children since the Media
    Stream WS handshake itself carries no query string or headers we
    control — Twilio echoes these back in the `start` event's
    `start.customParameters`.

    Args:
        stream_url: The `wss://` URL of our Media Stream WebSocket endpoint.
        org_id: The organization the call belongs to.
        contact_id: The resolved contact placing the call.
        signal_id: The `inbound_call` signal recorded for this call.

    Returns:
        str: The TwiML document, as XML text.
    """
    response = VoiceResponse()
    connect = Connect()
    stream = Stream(url=stream_url)
    stream.parameter(name="org_id", value=org_id)
    stream.parameter(name="contact_id", value=contact_id)
    stream.parameter(name="signal_id", value=signal_id)
    connect.append(stream)
    response.append(connect)
    return str(response)


def generate_voice_reject_twiml(*, message: str) -> str:
    """TwiML for a call that must not be answered by the agent (DNC/consent denial).

    Args:
        message: What to say to the caller before hanging up.

    Returns:
        str: The TwiML document, as XML text.
    """
    response = VoiceResponse()
    response.say(message)
    response.hangup()
    return str(response)
