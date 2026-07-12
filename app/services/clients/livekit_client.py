"""LiveKit Cloud helpers for inbound Twilio voice.

FastAPI gates DNC/consent, then returns TwiML that `<Dial><Sip>`s the org's
phone number into LiveKit (Twilio Programmable Voice pattern). A LiveKit
inbound trunk + individual dispatch rule create the room and dispatch the
Cloud agent. Mirenta correlation ids travel as SIP `X-Mirenta-*` headers on
the dial URI so the agent can bootstrap/finalize against FastAPI.
"""

from __future__ import annotations

from functools import lru_cache
from urllib.parse import urlencode

from livekit import api
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import logger

# Twilio Dial <Sip> custom headers (must use the x- prefix).
_HEADER_ORG_ID = "x-mirenta-org-id"
_HEADER_CONTACT_ID = "x-mirenta-contact-id"
_HEADER_SIGNAL_ID = "x-mirenta-signal-id"
_HEADER_CALL_SID = "x-mirenta-call-sid"


class PreparedVoiceRoom(BaseModel):
    """SIP dial target for Twilio to bridge into LiveKit."""

    dialed_number: str
    sip_uri: str


@lru_cache(maxsize=1)
def _livekit_api() -> api.LiveKitAPI:
    """Cached LiveKit server API client (URL + API key/secret from settings)."""
    return api.LiveKitAPI(
        url=settings.LIVEKIT_URL,
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )


def _e164(number: str) -> str:
    """Normalize a phone number to E.164 (+…) for LiveKit trunk matching."""
    stripped = number.strip()
    if stripped.startswith("+"):
        return stripped
    digits = "".join(ch for ch in stripped if ch.isdigit())
    return f"+{digits}" if digits else stripped


def voice_sip_uri(
    *,
    dialed_number: str,
    org_id: str,
    contact_id: str,
    signal_id: str,
    call_sid: str,
) -> str:
    """Build the Twilio `<Sip>` URI for LiveKit Programmable Voice ingress.

    LiveKit matches inbound trunks on the SIP URI user-part (the dialed number),
    not on an arbitrary room name. Mirenta ids are passed as Twilio custom
    SIP headers so the Cloud agent can bootstrap after the SIP participant joins.
    """
    host = settings.LIVEKIT_SIP_HOST.removeprefix("sip:")
    number = _e164(dialed_number)
    query = urlencode(
        {
            _HEADER_ORG_ID: org_id,
            _HEADER_CONTACT_ID: contact_id,
            _HEADER_SIGNAL_ID: signal_id,
            _HEADER_CALL_SID: call_sid,
        }
    )
    return f"sip:{number}@{host};transport=tcp?{query}"


def prepare_inbound_voice_room(
    *,
    call_sid: str,
    org_id: str,
    contact_id: str,
    signal_id: str,
    to_number: str,
) -> PreparedVoiceRoom:
    """Build the LiveKit SIP dial target for an answered inbound Twilio call.

    Room creation and agent dispatch are owned by the LiveKit inbound trunk +
    individual dispatch rule (see `docs/getting-started.md`). FastAPI only
    returns the SIP URI Twilio should dial.

    Args:
        call_sid: Twilio Call SID (also used as the durable provider_ref later).
        org_id: Organization owning the answered number.
        contact_id: Resolved contact placing the call.
        signal_id: `inbound_call` signal recorded for this call.
        to_number: Twilio `To` / org phone number (LiveKit trunk user-part).

    Returns:
        PreparedVoiceRoom: Dialed number + SIP URI for TwiML `<Dial><Sip>`.
    """
    dialed_number = _e164(to_number)
    sip_uri = voice_sip_uri(
        dialed_number=dialed_number,
        org_id=org_id,
        contact_id=contact_id,
        signal_id=signal_id,
        call_sid=call_sid,
    )
    logger.info(
        "livekit_voice_sip_prepared",
        dialed_number=dialed_number,
        call_sid=call_sid,
        org_id=org_id,
        contact_id=contact_id,
        agent_name=settings.LIVEKIT_AGENT_NAME,
    )
    return PreparedVoiceRoom(dialed_number=dialed_number, sip_uri=sip_uri)


async def aclose_livekit_api() -> None:
    """Close the cached LiveKit API client (app shutdown hook)."""
    if _livekit_api.cache_info().currsize == 0:
        return
    client = _livekit_api()
    await client.aclose()
    _livekit_api.cache_clear()
