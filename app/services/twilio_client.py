"""This file contains the Twilio client factory and outbound-messaging helpers."""

from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client
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
