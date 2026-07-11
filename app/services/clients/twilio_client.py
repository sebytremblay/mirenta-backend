"""This file contains the Twilio client factory and outbound-messaging/provisioning helpers."""

from twilio.base import values
from twilio.base.exceptions import TwilioRestException
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

_client: Client | None = None


def get_twilio_client() -> Client:
    """Get the cached Twilio REST client, authenticated with the account credentials.

    Returns:
        Client: A cached Twilio client authenticated with `TWILIO_ACCOUNT_SID` /
            `TWILIO_AUTH_TOKEN`.
    """
    global _client
    if _client is None:
        _client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    return _client


def _is_transient_twilio_error(exc: BaseException) -> bool:
    """Whether a Twilio error is worth retrying (5xx) vs. a permanent 4xx rejection."""
    return isinstance(exc, TwilioRestException) and exc.status >= 500


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_twilio_error),
    reraise=True,
)
async def send_sms(*, to: str, from_: str, body: str) -> str:
    """Send an outbound SMS via Twilio, retrying on transient (5xx) failures.

    Does not retry on 4xx errors (invalid number, unverified sender, etc.) —
    those are application-level rejections, not transient failures.

    Args:
        to: Destination phone number, E.164 format.
        from_: Sending organization's Twilio number, E.164 format.
        body: Message text.

    Returns:
        str: The Twilio message SID.
    """
    client = get_twilio_client()
    try:
        message = await client.messages.create_async(to=to, from_=from_, body=body)
    except TwilioRestException as e:
        logger.exception("twilio_sms_send_failed", to=to, from_=from_, status=e.status, error=e.msg)
        raise
    if message.sid is None:
        raise RuntimeError("twilio message create succeeded but returned no sid")
    logger.info("twilio_sms_sent", to=to, from_=from_, message_sid=message.sid)
    return message.sid


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception(_is_transient_twilio_error),
    reraise=True,
)
async def _find_available_local_number(area_code: str | None) -> str:
    """Search Twilio's US local-number inventory for one purchasable number.

    Read-only, so retrying on transient (5xx) failures is safe.

    Args:
        area_code: Optional 3-digit US area code to restrict the search to.

    Returns:
        str: An available number, E.164 format.

    Raises:
        RuntimeError: No number matched the search.
    """
    client = get_twilio_client()
    available = await client.available_phone_numbers("US").local.list_async(
        area_code=area_code or values.unset,
        sms_enabled=True,
        voice_enabled=True,
        limit=1,
    )
    if not available or available[0].phone_number is None:
        raise RuntimeError(f"no available twilio numbers found (area_code={area_code!r})")
    return available[0].phone_number


async def provision_phone_number(*, area_code: str | None = None) -> str:
    """Buy a new US local Twilio number and point its SMS + voice webhooks at this app.

    Not retried at the purchase step itself: a timed-out request that
    actually succeeded server-side would buy a second number on retry, so
    only the read-only search is safe to retry automatically.

    Args:
        area_code: Optional 3-digit US area code to search within.

    Returns:
        str: The purchased number, E.164 format.
    """
    client = get_twilio_client()
    phone_number = await _find_available_local_number(area_code)
    sms_url = f"{settings.APP_BASE_URL}{settings.API_PREFIX}/webhooks/twilio/sms"
    voice_url = f"{settings.APP_BASE_URL}{settings.API_PREFIX}/webhooks/twilio/voice"
    try:
        purchased = await client.incoming_phone_numbers.create_async(
            phone_number=phone_number,
            sms_url=sms_url,
            sms_method="POST",
            voice_url=voice_url,
            voice_method="POST",
        )
    except TwilioRestException as e:
        logger.exception("twilio_number_purchase_failed", phone_number=phone_number, status=e.status, error=e.msg)
        raise
    if purchased.phone_number is None:
        raise RuntimeError("twilio number purchase succeeded but returned no phone_number")
    logger.info("twilio_number_purchased", phone_number=purchased.phone_number, sms_url=sms_url, voice_url=voice_url)
    return purchased.phone_number


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
