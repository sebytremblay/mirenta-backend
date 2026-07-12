"""Mirenta inbound voice agent — deploy to LiveKit Cloud.

Native LiveKit Agents pipeline: Deepgram STT/TTS + OpenAI LLM. Twilio keeps
the phone numbers; FastAPI gates DNC/consent and SIP-dials a LiveKit room;
this worker owns the live session. On hangup it calls Mirenta's finalize API
so the Temporal contact loop re-enters.

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

from mirenta_client import MirentaVoiceClient

logger = logging.getLogger("mirenta-voice")

load_dotenv()

AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "mirenta-voice")
DEEPGRAM_STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3")
DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-asteria-en")
VOICE_LLM_MODEL = os.getenv("VOICE_LLM_MODEL", "gpt-4.1-mini")


def _parse_room_metadata(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("voice_room_metadata_invalid")
        return {}
    return data if isinstance(data, dict) else {}


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
    """Join a prepared Mirenta voice room and run the Deepgram + OpenAI pipeline."""
    ctx.log_context_fields = {"room": ctx.room.name}
    metadata = _parse_room_metadata(ctx.room.metadata)
    org_id = str(metadata.get("org_id") or "")
    contact_id = str(metadata.get("contact_id") or "")
    signal_id = str(metadata.get("signal_id") or "")
    call_sid = str(metadata.get("call_sid") or "")

    if not org_id or not contact_id or not signal_id or not call_sid:
        logger.error("voice_room_metadata_incomplete", room=ctx.room.name, metadata=metadata)
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
        logger.exception("voice_bootstrap_failed", call_sid=call_sid, room=ctx.room.name)
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
                "voice_finalize_ok",
                call_sid=call_sid,
                outcome=outcome,
                turns=len(transcript),
                reason=_reason,
            )
        except Exception:
            logger.exception("voice_finalize_failed", call_sid=call_sid)

    @session.on("close")
    def _on_close(ev: CloseEvent) -> None:
        logger.info("voice_session_closed", call_sid=call_sid, reason=str(ev.reason))

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
