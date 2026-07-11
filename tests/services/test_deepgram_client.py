"""Unit tests for app/services/deepgram_client.py.

Mocks the Deepgram client's `listen`/`speak` websocket connect calls the
same way `test_twilio_client.py` mocks `get_twilio_client` -- no real
network calls, no real Deepgram credentials.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from deepgram.speak.v1 import SpeakV1Flushed

from app.services.deepgram_client import (
    STT_CHANNELS,
    STT_ENCODING,
    STT_SAMPLE_RATE,
    TTS_ENCODING,
    TTS_SAMPLE_RATE,
    DeepgramSTTSession,
    DeepgramTTSSession,
)


class _FakeSocket:
    def __init__(self, messages: list) -> None:
        self._messages = list(messages)
        self.send_media = AsyncMock()
        self.send_close_stream = AsyncMock()
        self.send_text = AsyncMock()
        self.send_flush = AsyncMock()

    def __aiter__(self) -> "_FakeSocket":
        return self

    async def __anext__(self):
        if not self._messages:
            raise StopAsyncIteration
        return self._messages.pop(0)


class _FakeConnectContext:
    def __init__(self, socket: _FakeSocket) -> None:
        self._socket = socket

    async def __aenter__(self) -> _FakeSocket:
        return self._socket

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


class _FlakyConnectContext:
    """Fails `__aenter__` `fail_times` times before succeeding -- for retry tests."""

    def __init__(self, socket: _FakeSocket, fail_times: int) -> None:
        self._socket = socket
        self._fail_times = fail_times
        self.attempts = 0

    async def __aenter__(self) -> _FakeSocket:
        self.attempts += 1
        if self.attempts <= self._fail_times:
            raise RuntimeError("transient connect failure")
        return self._socket

    async def __aexit__(self, *exc_info: object) -> bool:
        return False


async def _noop(*_args: object, **_kwargs: object) -> None:
    return None


def test_stt_session_connects_with_telephony_params_and_closes_cleanly() -> None:
    socket = _FakeSocket([])
    connect_mock = MagicMock(return_value=_FakeConnectContext(socket))
    fake_client = MagicMock()
    fake_client.listen.v1.connect = connect_mock

    async def _run() -> None:
        with patch("app.services.deepgram_client.get_deepgram_client", return_value=fake_client):
            session = DeepgramSTTSession()
            await session.start(on_transcript=_noop, on_utterance_end=_noop, on_speech_started=_noop, on_error=_noop)
            await session.finish()

    asyncio.run(_run())

    _, kwargs = connect_mock.call_args
    assert kwargs["encoding"] == STT_ENCODING
    assert kwargs["sample_rate"] == STT_SAMPLE_RATE
    assert kwargs["channels"] == STT_CHANNELS
    socket.send_close_stream.assert_awaited_once()


def test_stt_session_start_retries_transient_connect_failure() -> None:
    socket = _FakeSocket([])
    flaky_ctx = _FlakyConnectContext(socket, fail_times=1)
    connect_mock = MagicMock(return_value=flaky_ctx)
    fake_client = MagicMock()
    fake_client.listen.v1.connect = connect_mock

    async def _run() -> None:
        with patch("app.services.deepgram_client.get_deepgram_client", return_value=fake_client):
            session = DeepgramSTTSession()
            await session.start(on_transcript=_noop, on_utterance_end=_noop, on_speech_started=_noop, on_error=_noop)
            await session.finish()

    asyncio.run(_run())

    assert flaky_ctx.attempts == 2


def test_tts_session_synthesizes_stream_until_flushed() -> None:
    audio_chunks = [b"\x01\x02", b"\x03\x04"]
    socket = _FakeSocket([*audio_chunks, SpeakV1Flushed(type="Flushed", sequence_id=0)])
    connect_mock = MagicMock(return_value=_FakeConnectContext(socket))
    fake_client = MagicMock()
    fake_client.speak.v1.connect = connect_mock

    async def _collect() -> list[bytes]:
        chunks: list[bytes] = []
        with patch("app.services.deepgram_client.get_deepgram_client", return_value=fake_client):
            async for chunk in DeepgramTTSSession().synthesize_stream("hello"):
                chunks.append(chunk)
        return chunks

    chunks = asyncio.run(_collect())

    assert chunks == audio_chunks
    socket.send_text.assert_awaited_once()
    socket.send_flush.assert_awaited_once()
    _, kwargs = connect_mock.call_args
    assert kwargs["encoding"] == TTS_ENCODING
    assert kwargs["sample_rate"] == TTS_SAMPLE_RATE
