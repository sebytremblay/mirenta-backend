"""Unit tests for app/services/runtimes/voice_runtime.py's VoiceCallSession turn-taking state machine.

Exercises transcript accumulation, turn triggering, barge-in cancellation,
and outcome inference with fakes/mocks -- no real Twilio/Deepgram network
calls (that requires the manual end-to-end verification in the plan).
"""

import asyncio
import time
from typing import cast
from unittest.mock import AsyncMock, patch

from fastapi import WebSocket
from langchain_core.messages import AIMessage

from app.services.runtimes.voice_runtime import VoiceCallSession, _opening_greeting


class _FakeWebSocket:
    def __init__(self) -> None:
        self.send_json = AsyncMock()
        self.receive_json = AsyncMock()


async def _empty_stream(_text: str):
    return
    yield  # pragma: no cover - makes this an async generator function


def _make_session() -> tuple[VoiceCallSession, _FakeWebSocket]:
    fake_ws = _FakeWebSocket()
    session = VoiceCallSession(websocket=cast(WebSocket, fake_ws), call_sid="CA123")
    session._org_id = "org-1"
    session._org_name = "Mirenta"
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
        {"role": "ai", "content": _opening_greeting("Mirenta")},
    ]
    assert session._infer_outcome() == "no_answer"


def test_opening_greeting_without_org_name_omits_company() -> None:
    assert _opening_greeting() == (
        "Hi, I am the AI receptionist. I can answer questions, take a message, or help you schedule a meeting."
    )
    assert _opening_greeting("Mirenta") == (
        "Hi, I am the AI receptionist for Mirenta. "
        "I can answer questions, take a message, or help you schedule a meeting."
    )


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
    session._knowledge = "Organization knowledge:\n- [hours] Hours: Mon-Fri 9-5"
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

            fake_agent.get_response.assert_awaited_once()
            call_kwargs = fake_agent.get_response.await_args.kwargs
            assert call_kwargs["metadata"]["knowledge"] == session._knowledge

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
        session._playback_first_frame_sent = True
        session._playback_barge_in_allowed_after = time.monotonic() - 1.0
        await asyncio.sleep(0)
        await session._handle_barge_in()

    asyncio.run(_run())
    assert session._current_playback is None
    fake_ws.send_json.assert_awaited_once_with({"event": "clear", "streamSid": "MZ123"})


def test_handshake_loads_knowledge_for_org() -> None:
    fake_ws = _FakeWebSocket()
    session = VoiceCallSession(websocket=cast(WebSocket, fake_ws), call_sid="CA123")

    async def _run() -> None:
        with (
            patch(
                "app.services.runtimes.voice_runtime.fetch_active_knowledge",
                new=AsyncMock(return_value=[]),
            ) as fetch_knowledge,
            patch(
                "app.services.runtimes.voice_runtime.format_knowledge_for_prompt",
                return_value="",
            ),
            patch(
                "app.services.runtimes.voice_runtime._fetch_org_display_name",
                new=AsyncMock(return_value="Mirenta"),
            ) as fetch_org_name,
        ):
            fake_ws.receive_json.side_effect = [
                {"event": "connected"},
                {
                    "event": "start",
                    "start": {
                        "streamSid": "MZ123",
                        "callSid": "CA123",
                        "customParameters": {"org_id": "org-1", "contact_id": "contact-1"},
                    },
                },
            ]
            ok = await session._handshake()
            assert ok is True
            fetch_knowledge.assert_awaited_once_with("org-1")
            fetch_org_name.assert_awaited_once_with("org-1")
            assert session._knowledge == ""
            assert session._knowledge_entry_count == 0
            assert session._org_name == "Mirenta"

    asyncio.run(_run())


def test_handle_barge_in_is_noop_without_active_playback() -> None:
    session, fake_ws = _make_session()

    asyncio.run(session._handle_barge_in())

    fake_ws.send_json.assert_not_awaited()


def test_barge_in_ignored_during_opening_greeting_grace() -> None:
    session, fake_ws = _make_session()
    session._opening_greeting_grace_until = time.monotonic() + 60.0

    async def _run() -> None:
        session._current_playback = asyncio.create_task(asyncio.sleep(10))
        await session._on_speech_started()

    asyncio.run(_run())
    fake_ws.send_json.assert_not_awaited()


def test_barge_in_allowed_after_opening_greeting_grace() -> None:
    session, fake_ws = _make_session()
    session._opening_greeting_grace_until = time.monotonic() - 1.0

    async def _long_task() -> None:
        await asyncio.sleep(10)

    async def _run() -> None:
        session._current_playback = asyncio.create_task(_long_task())
        session._playback_first_frame_sent = True
        session._playback_barge_in_allowed_after = time.monotonic() - 1.0
        await asyncio.sleep(0)
        await session._on_speech_started()

    asyncio.run(_run())
    fake_ws.send_json.assert_awaited_once_with({"event": "clear", "streamSid": "MZ123"})


def test_barge_in_blocked_before_first_playback_frame() -> None:
    session, fake_ws = _make_session()

    async def _run() -> None:
        session._current_playback = asyncio.create_task(asyncio.sleep(10))
        session._playback_barge_in_allowed_after = time.monotonic() - 1.0
        await session._on_speech_started()

    asyncio.run(_run())
    fake_ws.send_json.assert_not_awaited()
    assert session._current_playback is not None


def test_utterance_end_during_opening_greeting_grace_is_discarded() -> None:
    session, _ = _make_session()
    session._opening_greeting_grace_until = time.monotonic() + 60.0

    async def _run() -> None:
        with patch.object(session, "_handle_turn", new=AsyncMock()) as handle_turn:
            await session._on_transcript("Hello", True)
            await session._on_utterance_end()
            handle_turn.assert_not_awaited()

    asyncio.run(_run())
    assert session._pending_transcript == []
    assert session._transcript == []
