"""Mirenta inbound voice agent — deploy to LiveKit Cloud.

Native LiveKit Agents pipeline: Deepgram STT/TTS + OpenAI LLM. Twilio keeps
the phone numbers; FastAPI gates DNC/consent and SIP-dials LiveKit; this
worker owns the live session. On hangup it calls Mirenta's finalize API so
the Temporal contact loop re-enters.

Local:
  cd livekit_agent && uv sync && uv run src/agent.py dev

LiveKit Cloud:
  lk agent create   # once, from this directory
  lk agent deploy
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    CloseEvent,
    JobContext,
    cli,
    room_io,
)
from livekit.plugins import deepgram, openai, silero
from livekit.rtc import RemoteParticipant

from mirenta_client import MirentaVoiceClient

logger = logging.getLogger("mirenta-voice")

load_dotenv()

AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "mirenta-voice")
DEEPGRAM_STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3")
DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-asteria-en")
VOICE_LLM_MODEL = os.getenv("VOICE_LLM_MODEL", "gpt-4.1-mini")

# Participant attribute keys produced by trunk headers_to_attributes mapping.
_ATTR_ORG_ID = "mirenta.org_id"
_ATTR_CONTACT_ID = "mirenta.contact_id"
_ATTR_SIGNAL_ID = "mirenta.signal_id"
_ATTR_CALL_SID = "mirenta.call_sid"


def _parse_metadata(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("voice_metadata_invalid raw=%r", raw)
        return {}
    return data if isinstance(data, dict) else {}


def _attr(attrs: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = (attrs.get(key) or "").strip()
        if value:
            return value
    return ""


def _call_context_from_participant(participant: RemoteParticipant) -> dict[str, str]:
    """Resolve Mirenta ids from SIP participant attributes (Twilio X-headers)."""
    attrs = dict(participant.attributes or {})
    return {
        "org_id": _attr(attrs, _ATTR_ORG_ID, "sip.h.x-mirenta-org-id", "x-mirenta-org-id"),
        "contact_id": _attr(attrs, _ATTR_CONTACT_ID, "sip.h.x-mirenta-contact-id", "x-mirenta-contact-id"),
        "signal_id": _attr(attrs, _ATTR_SIGNAL_ID, "sip.h.x-mirenta-signal-id", "x-mirenta-signal-id"),
        "call_sid": _attr(attrs, _ATTR_CALL_SID, "sip.h.x-mirenta-call-sid", "x-mirenta-call-sid"),
    }


def _call_context_from_job(ctx: JobContext) -> dict[str, str]:
    """Fallback: job/room metadata (explicit API dispatch / older flows)."""
    job_meta = _parse_metadata(getattr(ctx.job, "metadata", None) or None)
    room_meta = _parse_metadata(ctx.room.metadata)
    merged = {**room_meta, **job_meta}
    return {
        "org_id": str(merged.get("org_id") or ""),
        "contact_id": str(merged.get("contact_id") or ""),
        "signal_id": str(merged.get("signal_id") or ""),
        "call_sid": str(merged.get("call_sid") or ""),
    }


def _transcript_from_history(session: AgentSession) -> list[dict[str, str]]:
    """Flatten LiveKit chat history into Mirenta's interaction transcript shape."""
    rows: list[dict[str, str]] = []
    for item in session.history.items:
        if getattr(item, "type", None) != "message":
            continue
        role = getattr(item, "role", None)
        text = (getattr(item, "text_content", None) or "").strip()
        if not text:
            continue
        if role == "user":
            rows.append({"role": "human", "content": text})
        elif role == "assistant":
            rows.append({"role": "ai", "content": text})
    return rows


def _infer_outcome(transcript: list[dict[str, str]]) -> str:
    if any(row.get("role") == "ai" for row in transcript):
        return "progressed"
    return "no_answer"


class MirentaVoiceAssistant(Agent):
    """Phone agent whose instructions are loaded from Mirenta bootstrap."""

    def __init__(self, *, instructions: str, greeting: str) -> None:
        super().__init__(instructions=instructions)
        self._greeting = greeting

    async def on_enter(self) -> None:
        self.session.generate_reply(instructions=f"Greet the caller with exactly: {self._greeting}")


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    """Join the LiveKit SIP room and run the Deepgram + OpenAI pipeline."""
    ctx.log_context_fields = {"room": ctx.room.name}
    await ctx.connect()

    # Prefer SIP participant attributes (Twilio X-headers via trunk mapping).
    # Fall back to job/room metadata for console/API dispatches.
    participant = await ctx.wait_for_participant()
    context = _call_context_from_participant(participant)
    if not all(context.values()):
        fallback = _call_context_from_job(ctx)
        context = {key: context[key] or fallback[key] for key in context}

    org_id = context["org_id"]
    contact_id = context["contact_id"]
    signal_id = context["signal_id"]
    call_sid = context["call_sid"]

    if not org_id or not contact_id or not signal_id or not call_sid:
        logger.error(
            "voice_room_metadata_incomplete room=%s participant_attrs=%r job_metadata=%r room_metadata=%r context=%s",
            ctx.room.name,
            dict(participant.attributes or {}),
            getattr(ctx.job, "metadata", None),
            ctx.room.metadata,
            context,
        )
        ctx.shutdown(reason="missing_mirenta_metadata")
        return

    mirenta = MirentaVoiceClient()
    try:
        bootstrap = await mirenta.bootstrap(
            org_id=org_id,
            contact_id=contact_id,
            signal_id=signal_id,
            call_sid=call_sid,
            room_name=ctx.room.name,
        )
    except Exception:
        logger.exception("voice_bootstrap_failed call_sid=%s room=%s", call_sid, ctx.room.name)
        ctx.shutdown(reason="bootstrap_failed")
        return

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model=DEEPGRAM_STT_MODEL),
        llm=openai.LLM(model=VOICE_LLM_MODEL),
        tts=deepgram.TTS(model=DEEPGRAM_TTS_MODEL),
    )

    finalized = False

    async def finalize_call(_reason: str = "") -> None:
        nonlocal finalized
        if finalized:
            return
        finalized = True
        transcript = _transcript_from_history(session)
        outcome = _infer_outcome(transcript)
        try:
            await mirenta.finalize(
                org_id=org_id,
                contact_id=contact_id,
                signal_id=signal_id,
                call_sid=call_sid,
                transcript=transcript,
                outcome=outcome,
                room_name=ctx.room.name,
            )
            logger.info(
                "voice_finalize_ok call_sid=%s outcome=%s turns=%s reason=%s",
                call_sid,
                outcome,
                len(transcript),
                _reason,
            )
        except Exception:
            logger.exception("voice_finalize_failed call_sid=%s", call_sid)

    @session.on("close")
    def _on_close(ev: CloseEvent) -> None:
        logger.info("voice_session_closed call_sid=%s reason=%s", call_sid, ev.reason)

    ctx.add_shutdown_callback(finalize_call)

    await session.start(
        agent=MirentaVoiceAssistant(
            instructions=str(bootstrap["instructions"]),
            greeting=str(bootstrap["greeting"]),
        ),
        room=ctx.room,
        room_options=room_io.RoomOptions(audio_input=True, audio_output=True),
    )


if __name__ == "__main__":
    cli.run_app(server)
