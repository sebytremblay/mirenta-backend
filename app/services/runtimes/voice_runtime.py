"""Bridges one live Twilio Media Stream call to Deepgram STT/TTS and the voice LangGraph subagent.

Runs outside Temporal: a phone call is a single long-lived duplex audio
session that doesn't fit inside a bounded Temporal activity, and workflow
code can't do raw I/O at all. `VoiceCallSession` owns the entire call for
its duration; only the terminal "log interaction, emit interaction_result
signal" step re-enters the Temporal-driven contact loop, exactly like SMS's
own closing step. See `docs/architecture.md`'s voice-runtime section.

This is the second (and only other) entry point into the generative
LangGraph layer alongside `activities/interactions.py` -- the invariant that
actually matters, per AGENTS.md, is that `decision/` never imports from
`app.core.langgraph`, not that exactly one file does.
"""

import asyncio
import base64
import contextlib
import time
from collections.abc import Coroutine
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from langchain_core.messages import AIMessage, HumanMessage

from activities.logging import (
    EmitInteractionResultSignalInput,
    LogInteractionInput,
    emit_interaction_result_signal,
    log_interaction,
)
from app.core.langgraph.voice_graph import voice_agent
from app.core.logging import logger
from app.services.clients.deepgram_client import DeepgramSTTSession, DeepgramTTSSession
from app.services.clients.supabase_client import execute_query, get_service_role_client
from app.services.knowledge import fetch_active_knowledge, format_knowledge_for_prompt

VOICE_CHANNEL_CONSTRAINTS = {"max_length": 600}
TTS_FRAME_BYTES = 160  # 20ms of 8kHz mulaw
TTS_FRAME_SECONDS = 0.02
OPENING_GREETING_BARGE_IN_GRACE_SECONDS = 2.0
PLAYBACK_BARGE_IN_GRACE_SECONDS = 0.75


def _opening_greeting(org_name: str | None = None) -> str:
    """Fixed spoken open — TTS only, no LLM round-trip (keeps time-to-first-audio low)."""
    capabilities = "I can answer questions, take a message, or help you schedule a meeting."
    if org_name:
        return f"Hi, I am the AI receptionist for {org_name}. {capabilities}"
    return f"Hi, I am the AI receptionist. {capabilities}"


async def _fetch_org_display_name(org_id: str) -> str | None:
    """Load the org display name for the spoken opening greeting."""
    client = await get_service_role_client()
    try:
        response = await execute_query(client.table("organizations").select("name").eq("id", org_id).single())
        name = response.data.get("name") if response.data else None
        if isinstance(name, str) and name.strip():
            return name.strip()
    except Exception:
        logger.exception("voice_org_name_fetch_failed", org_id=org_id)
    return None


class VoiceCallSession:
    """Owns one live inbound call, from Twilio's `start` event through hangup."""

    def __init__(self, *, websocket: WebSocket, call_sid: str) -> None:
        """Initialize call state; nothing is opened until `run()` is awaited."""
        self._websocket = websocket
        self._call_sid = call_sid
        self._stream_sid: str | None = None
        self._org_id: str | None = None
        self._org_name: str | None = None
        self._contact_id: str | None = None
        self._stt = DeepgramSTTSession()
        self._pending_transcript: list[str] = []
        self._transcript: list[dict[str, str]] = []
        self._current_playback: asyncio.Task[None] | None = None
        self._opening_greeting_grace_until: float | None = None
        self._playback_barge_in_allowed_after: float | None = None
        self._playback_first_frame_sent = False
        self._any_turn_completed = False
        self._any_turn_escalated = False
        self._knowledge = ""
        self._knowledge_entry_count = 0

    async def run(self) -> None:
        """Accept the call, bridge audio for its duration, then close the loop."""
        await self._websocket.accept()
        try:
            if not await self._handshake():
                return
            await self._stt.start(
                on_transcript=self._on_transcript,
                on_utterance_end=self._on_utterance_end,
                on_speech_started=self._on_speech_started,
                on_error=self._on_stt_error,
            )
            # Fire-and-forget: must not block `_read_media_loop` or Twilio
            # audio (and barge-in) stalls while the greeting synthesizes.
            self._start_opening_greeting()
            await self._read_media_loop()
        except WebSocketDisconnect:
            logger.info("voice_ws_disconnected", call_sid=self._call_sid)
        except Exception:
            logger.exception("voice_ws_session_failed", call_sid=self._call_sid)
        finally:
            await self._stt.finish()
            await self._cancel_playback()
            await self._finalize_call()

    async def _handshake(self) -> bool:
        """Read Twilio's `connected`/`start` protocol messages before touching Deepgram.

        Returns:
            bool: Whether the handshake resolved enough context to proceed.
        """
        connected = await self._websocket.receive_json()
        if connected.get("event") != "connected":
            logger.warning("voice_ws_unexpected_first_event", event=connected.get("event"))

        start_message = await self._websocket.receive_json()
        if start_message.get("event") != "start":
            logger.warning("voice_ws_missing_start_event", event=start_message.get("event"))
            return False

        start = start_message.get("start", {})
        self._stream_sid = start.get("streamSid")
        call_sid = start.get("callSid")
        if call_sid != self._call_sid:
            logger.warning("voice_ws_call_sid_mismatch", path_call_sid=self._call_sid, start_call_sid=call_sid)
            return False

        params = start.get("customParameters", {})
        self._org_id = params.get("org_id")
        self._contact_id = params.get("contact_id")
        if not self._org_id or not self._contact_id:
            logger.warning("voice_ws_missing_correlation_params", call_sid=self._call_sid)
            return False

        knowledge_entries = await fetch_active_knowledge(self._org_id)
        self._knowledge = format_knowledge_for_prompt(knowledge_entries)
        self._knowledge_entry_count = len(knowledge_entries)
        self._org_name = await _fetch_org_display_name(self._org_id)
        logger.info(
            "voice_ws_connected",
            call_sid=self._call_sid,
            org_id=self._org_id,
            contact_id=self._contact_id,
            org_name=self._org_name,
            knowledge_entries=self._knowledge_entry_count,
        )
        return True

    async def _read_media_loop(self) -> None:
        """Forward `media` frames to Deepgram until Twilio sends `stop`."""
        while True:
            message = await self._websocket.receive_json()
            event = message.get("event")
            if event == "media":
                payload = message.get("media", {}).get("payload", "")
                if payload:
                    await self._stt.send_audio(base64.b64decode(payload))
            elif event == "stop":
                logger.info("voice_ws_stop_received", call_sid=self._call_sid)
                break

    def _start_opening_greeting(self) -> None:
        """Speak a fixed greeting as soon as the media stream is live.

        Uses a canned line + TTS rather than the LangGraph turn path so the
        caller hears audio within ~TTS latency instead of waiting on a cold
        LLM/checkpointer round-trip. Does not set `_any_turn_completed` —
        greeting-only hangups still count as `no_answer`.
        """
        greeting = _opening_greeting(self._org_name)
        self._transcript.append({"role": "ai", "content": greeting})
        logger.info("voice_greeting_started", call_sid=self._call_sid, reply_length=len(greeting))
        self._opening_greeting_grace_until = time.monotonic() + OPENING_GREETING_BARGE_IN_GRACE_SECONDS
        self._start_playback(self._play_opening_greeting(greeting))

    def _start_playback(self, coro: Coroutine[Any, Any, None]) -> None:
        """Begin TTS playback and arm barge-in suppression until audio is flowing."""
        self._playback_first_frame_sent = False
        self._playback_barge_in_allowed_after = time.monotonic() + PLAYBACK_BARGE_IN_GRACE_SECONDS
        self._current_playback = asyncio.create_task(coro)

    async def _play_opening_greeting(self, greeting: str) -> None:
        """Play the canned greeting; suppress false barge-in for the first couple seconds."""
        try:
            await self._play_reply(greeting)
        finally:
            self._opening_greeting_grace_until = None
            self._playback_barge_in_allowed_after = None
            self._playback_first_frame_sent = False

    def _in_opening_greeting_grace(self) -> bool:
        """Whether barge-in/turn-taking should stay suppressed on the opening greeting."""
        return self._opening_greeting_grace_until is not None and time.monotonic() < self._opening_greeting_grace_until

    def _barge_in_allowed(self) -> bool:
        """Whether caller speech should interrupt in-flight agent playback."""
        if self._in_opening_greeting_grace():
            return False
        if self._current_playback is None or self._current_playback.done():
            return False
        if not self._playback_first_frame_sent:
            return False
        if self._playback_barge_in_allowed_after is not None and time.monotonic() < self._playback_barge_in_allowed_after:
            return False
        return True

    async def _on_transcript(self, text: str, is_final: bool) -> None:
        """Accumulate finalized transcript pieces; the turn fires on `UtteranceEnd`."""
        if is_final:
            self._pending_transcript.append(text)

    async def _on_utterance_end(self) -> None:
        """The caller has finished a turn -- compose and speak a reply."""
        if self._in_opening_greeting_grace():
            self._pending_transcript = []
            return
        if not self._pending_transcript:
            return
        utterance = " ".join(self._pending_transcript).strip()
        self._pending_transcript = []
        if not utterance:
            return
        self._transcript.append({"role": "human", "content": utterance})
        await self._handle_turn(utterance)

    async def _on_speech_started(self) -> None:
        """Deepgram's VAD detected new speech -- interrupt playback if the agent is talking."""
        if not self._barge_in_allowed():
            return
        await self._handle_barge_in()

    async def _on_stt_error(self, exc: Exception) -> None:
        """Deepgram's background message loop failed -- log and let the call wind down.

        Args:
            exc: The exception raised inside `DeepgramSTTSession`'s consumer loop.
        """
        logger.exception("voice_stt_session_error", call_sid=self._call_sid, error=str(exc))

    async def _handle_turn(self, utterance_text: str) -> None:
        """One conversational turn -- analogous to `run_interaction`, invoked inline.

        No per-turn `Task` row exists for a live inbound call, so this calls
        `voice_agent.get_response` directly rather than going through
        `activities/interactions.py`.
        """
        if self._org_id is None or self._contact_id is None:
            return
        session_id = f"voice:{self._org_id}:{self._contact_id}"
        try:
            response_messages = await voice_agent.get_response(
                [HumanMessage(content=utterance_text)],
                session_id=session_id,
                metadata={
                    "contact_id": self._contact_id,
                    "task_goal": "converse_inbound_call",
                    "channel_constraints": VOICE_CHANNEL_CONSTRAINTS,
                    "knowledge": self._knowledge,
                },
            )
        except Exception:
            logger.exception("voice_turn_failed", call_sid=self._call_sid)
            return

        reply_message = next(
            (
                message
                for message in reversed(response_messages)
                if isinstance(message, AIMessage) and isinstance(message.content, str) and message.content
            ),
            None,
        )
        if reply_message is None or not isinstance(reply_message.content, str):
            return

        reply_text = reply_message.content
        if bool(reply_message.additional_kwargs.get("guardrail_escalated")):
            self._any_turn_escalated = True

        self._any_turn_completed = True
        self._transcript.append({"role": "ai", "content": reply_text})
        logger.info(
            "voice_turn_composed",
            call_sid=self._call_sid,
            reply_length=len(reply_text),
            knowledge_entries=self._knowledge_entry_count,
        )

        await self._cancel_playback()
        self._start_playback(self._play_reply(reply_text))

    async def _play_reply(self, text: str) -> None:
        """Synthesize `text` and stream it back to Twilio as paced mulaw frames."""
        tts = DeepgramTTSSession()
        buffer = b""
        frames_sent = 0
        try:
            async for chunk in tts.synthesize_stream(text):
                buffer += chunk
                while len(buffer) >= TTS_FRAME_BYTES:
                    frame, buffer = buffer[:TTS_FRAME_BYTES], buffer[TTS_FRAME_BYTES:]
                    await self._send_media_frame(frame)
                    frames_sent += 1
                    await asyncio.sleep(TTS_FRAME_SECONDS)
            if buffer:
                await self._send_media_frame(buffer)
                frames_sent += 1
            logger.info("voice_playback_completed", call_sid=self._call_sid, frames_sent=frames_sent)
        except asyncio.CancelledError:
            logger.info("voice_playback_cancelled", call_sid=self._call_sid, frames_sent=frames_sent)
            raise
        except Exception:
            logger.exception("voice_tts_playback_failed", call_sid=self._call_sid, frames_sent=frames_sent)
        finally:
            self._playback_barge_in_allowed_after = None
            self._playback_first_frame_sent = False

    async def _send_media_frame(self, frame: bytes) -> None:
        if not self._playback_first_frame_sent:
            self._playback_first_frame_sent = True
            self._playback_barge_in_allowed_after = time.monotonic() + PLAYBACK_BARGE_IN_GRACE_SECONDS
            logger.info("voice_playback_first_frame", call_sid=self._call_sid)
        await self._websocket.send_json(
            {
                "event": "media",
                "streamSid": self._stream_sid,
                "media": {"payload": base64.b64encode(frame).decode("ascii")},
            }
        )

    async def _cancel_playback(self) -> None:
        """Cancel the in-flight TTS playback task, if any, and wait for it to unwind."""
        if self._current_playback is None:
            return
        task, self._current_playback = self._current_playback, None
        self._playback_barge_in_allowed_after = None
        self._playback_first_frame_sent = False
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _handle_barge_in(self) -> None:
        """On new speech while a reply is playing: stop it and flush Twilio's playback buffer."""
        if not self._barge_in_allowed():
            return
        logger.info("voice_barge_in", call_sid=self._call_sid)
        await self._cancel_playback()
        with contextlib.suppress(Exception):
            await self._websocket.send_json({"event": "clear", "streamSid": self._stream_sid})

    def _infer_outcome(self) -> str:
        """Mirror `TaskExecutionWorkflow`'s escalation/progress outcome logic, plus `no_answer`."""
        if self._any_turn_escalated:
            return "handoff_human"
        if not self._any_turn_completed:
            return "no_answer"
        return "progressed"

    async def _finalize_call(self) -> None:
        """Log the interaction and re-enter the Temporal-driven contact loop.

        Calls `log_interaction`/`emit_interaction_result_signal` as plain
        coroutines, not via `workflow.execute_activity`: neither touches the
        Temporal activity-context API, so both are safe to call directly
        from outside a workflow. A crash between Twilio's `stop` event and
        this completing loses that interaction's logging/loop re-entry --
        an accepted gap for this pass, since the live call itself is
        already lost on crash regardless.
        """
        if self._org_id is None or self._contact_id is None:
            return
        outcome = self._infer_outcome()
        try:
            interaction_id = await log_interaction(
                LogInteractionInput(
                    org_id=self._org_id,
                    contact_id=self._contact_id,
                    task_id=None,
                    channel="voice",
                    direction="inbound",
                    agent_graph=voice_agent.agent_name,
                    transcript=self._transcript,
                    outcome=outcome,
                    provider_ref=self._call_sid,
                    guardrail_flags=[{"violation": "escalated"}] if self._any_turn_escalated else [],
                )
            )
            await emit_interaction_result_signal(
                EmitInteractionResultSignalInput(
                    org_id=self._org_id,
                    contact_id=self._contact_id,
                    interaction_id=interaction_id,
                    channel="voice",
                    outcome=outcome,
                    summary=None,
                )
            )
            logger.info("voice_call_finalized", call_sid=self._call_sid, outcome=outcome)
        except Exception:
            logger.exception("voice_call_finalize_failed", call_sid=self._call_sid)
