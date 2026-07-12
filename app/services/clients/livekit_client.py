"""LiveKit Cloud room + agent-dispatch helpers for inbound Twilio voice.

FastAPI uses this only at call-answer time: create a room with Mirenta
correlation metadata, explicitly dispatch the Cloud-hosted agent, then return
TwiML that `<Dial><Sip>`s into that room. The live STT/LLM/TTS session runs
inside the LiveKit Agents worker, not in this process.
"""

from __future__ import annotations

import json
from functools import lru_cache

from livekit import api
from pydantic import BaseModel
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.logging import logger


class PreparedVoiceRoom(BaseModel):
    """Room ready for Twilio to SIP-dial into."""

    room_name: str
    sip_uri: str


@lru_cache(maxsize=1)
def _livekit_api() -> api.LiveKitAPI:
    """Cached LiveKit server API client (URL + API key/secret from settings)."""
    return api.LiveKitAPI(
        url=settings.LIVEKIT_URL,
        api_key=settings.LIVEKIT_API_KEY,
        api_secret=settings.LIVEKIT_API_SECRET,
    )


def voice_room_name(call_sid: str) -> str:
    """Deterministic LiveKit room name for one Twilio CallSid."""
    return f"call-{call_sid}"


def voice_sip_uri(room_name: str) -> str:
    """SIP URI Twilio dials so LiveKit routes the call into `room_name`."""
    host = settings.LIVEKIT_SIP_HOST.removeprefix("sip:")
    return f"sip:{room_name}@{host};transport=tcp"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
async def prepare_inbound_voice_room(
    *,
    call_sid: str,
    org_id: str,
    contact_id: str,
    signal_id: str,
) -> PreparedVoiceRoom:
    """Create a LiveKit room, dispatch the Cloud agent, return the SIP dial target.

    Args:
        call_sid: Twilio Call SID (also used as the durable provider_ref later).
        org_id: Organization owning the answered number.
        contact_id: Resolved contact placing the call.
        signal_id: `inbound_call` signal recorded for this call.

    Returns:
        PreparedVoiceRoom: Room name + SIP URI for TwiML `<Dial><Sip>`.
    """
    room_name = voice_room_name(call_sid)
    metadata = json.dumps(
        {
            "org_id": org_id,
            "contact_id": contact_id,
            "signal_id": signal_id,
            "call_sid": call_sid,
        }
    )
    lk = _livekit_api()
    await lk.room.create_room(
        api.CreateRoomRequest(
            name=room_name,
            metadata=metadata,
            empty_timeout=settings.LIVEKIT_ROOM_EMPTY_TIMEOUT_SECONDS,
            max_participants=4,
        )
    )
    await lk.agent_dispatch.create_dispatch(
        api.CreateAgentDispatchRequest(
            agent_name=settings.LIVEKIT_AGENT_NAME,
            room=room_name,
            metadata=metadata,
        )
    )
    sip_uri = voice_sip_uri(room_name)
    logger.info(
        "livekit_voice_room_prepared",
        room_name=room_name,
        call_sid=call_sid,
        org_id=org_id,
        contact_id=contact_id,
        agent_name=settings.LIVEKIT_AGENT_NAME,
    )
    return PreparedVoiceRoom(room_name=room_name, sip_uri=sip_uri)


async def aclose_livekit_api() -> None:
    """Close the cached LiveKit API client (app shutdown hook)."""
    if _livekit_api.cache_info().currsize == 0:
        return
    client = _livekit_api()
    await client.aclose()
    _livekit_api.cache_clear()
