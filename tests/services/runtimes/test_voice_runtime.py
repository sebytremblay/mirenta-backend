"""Unit tests for app/services/runtimes/voice_runtime.py's VoiceCallSession turn-taking state machine.

Exercises transcript accumulation, turn triggering, barge-in cancellation,
and outcome inference with fakes/mocks -- no real Twilio/Deepgram network
calls (that requires the manual end-to-end verification in the plan).
"""

import asyncio
from typing import cast
from unittest.mock import AsyncMock, patch

from fastapi import WebSocket
from langchain_core.messages import AIMessage

from app.services.runtimes.voice_runtime import VoiceCallSession, _opening_greeting


class _FakeWebSocket:
    def __init__(self) -> None:
        self.send_json = AsyncMock()


async def _empty_stream(_text: str):
    return
    yield  # pragma: no cover - makes this an async generator function


def _make_session() -> tuple[VoiceCallSession, _FakeWebSocket]:
    fake_ws = _FakeWebSocket()
    session = VoiceCallSession(websocket=cast(WebSocket, fake_ws), call_sid="CA123")
    session._org_id = "org-1"
    session._contact_id = "contact-1"
    session._stream_sid = "MZ123"
    return session, fake_ws


def test_start_opening_greeting_queues_tts_and_transcript() -> None:
    session, _ = _make_session()

    async def _run() -> None:
        with patch("app.services.runtimes.voice_runtime.DeepgramTTSSession") as fake_tts_cls:
            fake_tts_cls.return_value.synthesize_stream = _empty_stream
            session._start_opening_greeting()
            playback = session._current_playback
            assert playback is not None
            await playback

    asyncio.run(_run())
    assert session._any_turn_completed is False
    assert session._transcript == [
        {"role": "ai", "content": _opening_greeting()},
    ]
    assert session._infer_outcome() == "no_answer"


def test_utterance_end_joins_pending_transcript_and_triggers_turn() -> None:
    session, _ = _make_session()

    async def _run() -> None:
        with patch.object(session, "_handle_turn", new=AsyncMock()) as handle_turn:
            await session._on_transcript("Hello", True)
            await session._on_transcript("there", True)
            await session._on_transcript("ignored interim", False)
            await session._on_utterance_end()
            handle_turn.assert_awaited_once_with("Hello there")

    asyncio.run(_run())
    assert session._transcript == [{"role": "human", "content": "Hello there"}]
    assert session._pending_transcript == []


def test_utterance_end_is_noop_with_no_pending_transcript() -> None:
    session, _ = _make_session()

    async def _run() -> None:
        with patch.object(session, "_handle_turn", new=AsyncMock()) as handle_turn:
            await session._on_utterance_end()
            handle_turn.assert_not_awaited()

    asyncio.run(_run())


def test_handle_turn_composes_reply_and_starts_playback() -> None:
    session, _ = _make_session()
    reply = AIMessage(content="See you soon.")

    async def _run() -> None:
        with (
            patch("app.services.runtimes.voice_runtime.voice_agent") as fake_agent,
            patch("app.services.runtimes.voice_runtime.DeepgramTTSSession") as fake_tts_cls,
        ):
            fake_agent.get_response = AsyncMock(return_value=[reply])
            fake_agent.agent_name = "voice_agent"
            fake_tts_cls.return_value.synthesize_stream = _empty_stream

            await session._handle_turn("Hi there")
            playback = session._current_playback
            assert playback is not None
            await playback

    asyncio.run(_run())
    assert session._any_turn_completed is True
    assert session._transcript[-1] == {"role": "ai", "content": "See you soon."}


def test_handle_turn_marks_escalation() -> None:
    session, _ = _make_session()
    reply = AIMessage(content="Let me have someone follow up.", additional_kwargs={"guardrail_escalated": True})

    async def _run() -> None:
        with (
            patch("app.services.runtimes.voice_runtime.voice_agent") as fake_agent,
            patch("app.services.runtimes.voice_runtime.DeepgramTTSSession") as fake_tts_cls,
        ):
            fake_agent.get_response = AsyncMock(return_value=[reply])
            fake_tts_cls.return_value.synthesize_stream = _empty_stream
            await session._handle_turn("Hi there")
            playback = session._current_playback
            assert playback is not None
            await playback

    asyncio.run(_run())
    assert session._any_turn_escalated is True
    assert session._infer_outcome() == "handoff_human"


def test_infer_outcome_no_answer_when_no_turn_completed() -> None:
    session, _ = _make_session()
    assert session._infer_outcome() == "no_answer"


def test_infer_outcome_progressed_after_a_clean_turn() -> None:
    session, _ = _make_session()
    session._any_turn_completed = True
    assert session._infer_outcome() == "progressed"


def test_handle_barge_in_cancels_playback_and_sends_clear() -> None:
    session, fake_ws = _make_session()

    async def _long_task() -> None:
        await asyncio.sleep(10)

    async def _run() -> None:
        session._current_playback = asyncio.create_task(_long_task())
        await asyncio.sleep(0)  # let the task actually start
        await session._handle_barge_in()

    asyncio.run(_run())
    assert session._current_playback is None
    fake_ws.send_json.assert_awaited_once_with({"event": "clear", "streamSid": "MZ123"})


def test_handle_barge_in_is_noop_without_active_playback() -> None:
    session, fake_ws = _make_session()

    asyncio.run(session._handle_barge_in())

    fake_ws.send_json.assert_not_awaited()
