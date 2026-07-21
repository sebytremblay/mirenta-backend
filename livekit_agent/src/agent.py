"""Mirenta voice agent — deploy to LiveKit Cloud.

Native LiveKit Agents pipeline: Deepgram STT/TTS + OpenAI LLM. Runs
standalone (console / Agent Console / WebRTC) and is also dispatched onto
real Twilio PSTN calls via a LiveKit SIP inbound trunk (see
`livekit_agent/sip/`). When Mirenta correlation metadata is present, this
worker bootstraps instructions from FastAPI and finalizes so the Temporal
contact loop can re-enter.

Local:
  cd livekit_agent && uv sync && uv run src/agent.py console   # mic/speakers, no Cloud
  cd livekit_agent && uv sync && uv run src/agent.py dev       # Cloud jobs / Agent Console

LiveKit Cloud:
  lk agent create   # once, from this directory
  lk agent deploy
"""

from __future__ import annotations

import asyncio
import logging
import os

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
from livekit.rtc import ParticipantKind, RemoteParticipant

from call_context import infer_outcome, merge_call_context
from mirenta_client import MirentaVoiceClient
from scheduling_tools import build_scheduling_tools

logger = logging.getLogger("mirenta-voice")

load_dotenv()

AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "mirenta-voice")
DEEPGRAM_STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3")
DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-asteria-en")
VOICE_LLM_MODEL = os.getenv("VOICE_LLM_MODEL", "gpt-4.1-mini")

# DEMO HACK (not for main): bias nova-3 toward the NATO phonetic code words so
# spelled-out emails stop coming back as "Jira"/"Skira" for "Sierra". Deepgram
# nova-3 keyterm prompting boosts recognition of these exact tokens. The demo
# address is seeded too so the STT snaps to it. Real fix lives on
# fix/voice-email-slot-capture (deterministic capture_email tool).
_NATO_KEYTERMS = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
    "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
    "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
    "x-ray", "yankee", "zulu",
]
_DEMO_KEYTERMS = ["sebybas", "gmail", "at", "dot"]
_STT_KEYTERMS = _NATO_KEYTERMS + _DEMO_KEYTERMS

# SIP headers_to_attributes can arrive shortly after the participant joins.
_SIP_ATTR_WAIT_SECONDS = 3.0
_SIP_ATTR_POLL_INTERVAL = 0.1

# Offline fallback for non-SIP joins (Agent Console / local console). Real SIP
# calls load greeting + instructions from FastAPI bootstrap
# (`app/core/prompts/voice*.md`) — keep these roughly in sync for playground UX.
_CONSOLE_GREETING = (
    "Hi, I am the AI receptionist for Mirenta, I can answer questions, take a message, or help you schedule a meeting"
)
_CONSOLE_INSTRUCTIONS = (
    "You are Mirenta, a helpful voice agent under local/console test. "
    "You are speaking on a live call. Respond in plain spoken sentences. "
    "Keep replies brief (one to three sentences). Ask one question at a time. "
    "Never use markdown, lists, emojis, or special formatting. "
    "Do not greet the caller again if you have already greeted them. "
    "If you lack information, say so honestly rather than inventing details. "
    "Do not invent organization-specific facts; say you don't have that info."
)


def _merge_call_context(participant: RemoteParticipant, ctx: JobContext) -> dict[str, str]:
    return merge_call_context(
        dict(participant.attributes or {}),
        getattr(ctx.job, "metadata", None) or None,
        ctx.room.metadata,
    )


async def _wait_for_mirenta_context(
    participant: RemoteParticipant,
    ctx: JobContext,
    *,
    timeout_seconds: float = _SIP_ATTR_WAIT_SECONDS,
) -> dict[str, str]:
    """Poll until Mirenta ids appear or the timeout elapses.

    LiveKit may deliver trunk `headers_to_attributes` after the SIP participant
    first joins, so a single read at wait_for_participant() can miss them.
    """
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    context = _merge_call_context(participant, ctx)
    while not all(context.values()) and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(_SIP_ATTR_POLL_INTERVAL)
        context = _merge_call_context(participant, ctx)
    return context


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


def _build_agent_session() -> AgentSession:
    return AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model=DEEPGRAM_STT_MODEL, keyterm=_STT_KEYTERMS),
        llm=openai.LLM(model=VOICE_LLM_MODEL),
        tts=deepgram.TTS(model=DEEPGRAM_TTS_MODEL),
        preemptive_generation=True,
    )


class MirentaVoiceAssistant(Agent):
    """Phone agent whose instructions are loaded from Mirenta bootstrap."""

    def __init__(self, *, instructions: str, greeting: str, tools: list | None = None) -> None:
        super().__init__(instructions=instructions, tools=tools or [])
        self._greeting = greeting

    async def on_enter(self) -> None:
        self.session.generate_reply(instructions=f"Greet the caller with exactly: {self._greeting}")


server = AgentServer()


async def _start_console_session(ctx: JobContext) -> None:
    """Playground session for any non-SIP join (Agent Console, `agent.py console`, …)."""
    session = _build_agent_session()

    @session.on("close")
    def _on_close(ev: CloseEvent) -> None:
        logger.info("voice_session_closed label=%s reason=%s", "console", ev.reason)

    await session.start(
        agent=MirentaVoiceAssistant(
            instructions=_CONSOLE_INSTRUCTIONS,
            greeting=_CONSOLE_GREETING,
        ),
        room=ctx.room,
        room_options=room_io.RoomOptions(audio_input=True, audio_output=True),
    )


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    """Join the LiveKit room and run the Deepgram + OpenAI pipeline.

    SIP participants (if any) may supply Mirenta ids via participant
    attributes / job metadata for bootstrap/finalize. Everything else — the
    local `console` CLI, the browser-based Agent Console, or a manual test
    participant — joins as a standard participant and gets a playground
    session with default instructions, skipping Mirenta bootstrap/finalize.
    """
    ctx.log_context_fields = {"room": ctx.room.name}
    await ctx.connect()

    participant = await ctx.wait_for_participant()
    if participant.kind != ParticipantKind.PARTICIPANT_KIND_SIP:
        logger.info(
            "voice_console_mode room=%s participant_kind=%s reason=not_sip_participant",
            ctx.room.name,
            participant.kind,
        )
        await _start_console_session(ctx)
        return

    # SIP / explicit dispatch: Mirenta ids from participant attributes or
    # job/room metadata.
    context = await _wait_for_mirenta_context(participant, ctx)

    org_id = context["org_id"]
    contact_id = context["contact_id"]
    signal_id = context["signal_id"]
    call_sid = context["call_sid"]

    if not (org_id and contact_id and signal_id and call_sid):
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

    session = _build_agent_session()

    finalized = False

    async def finalize_call(_reason: str = "") -> None:
        nonlocal finalized
        if finalized:
            return
        finalized = True
        transcript = _transcript_from_history(session)
        outcome = infer_outcome(transcript)
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
        logger.info("voice_session_closed label=%s reason=%s", call_sid, ev.reason)

    ctx.add_shutdown_callback(finalize_call)

    scheduling_tools = build_scheduling_tools(
        mirenta=mirenta,
        org_id=org_id,
        contact_id=contact_id,
    )

    await session.start(
        agent=MirentaVoiceAssistant(
            instructions=str(bootstrap["instructions"]),
            greeting=str(bootstrap["greeting"]),
            tools=scheduling_tools,
        ),
        room=ctx.room,
        room_options=room_io.RoomOptions(audio_input=True, audio_output=True),
    )


if __name__ == "__main__":
    cli.run_app(server)
