"""Deepgram streaming STT + TTS clients for the voice channel.

Wraps `deepgram-sdk`'s async `listen`/`speak` websocket clients with a cached
client factory, connect-time retries, and structlog logging, following
`app/services/clients/twilio_client.py`'s conventions.
"""

import asyncio
import contextlib
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import AsyncExitStack

from deepgram import AsyncDeepgramClient
from deepgram.listen.v1 import ListenV1Results, ListenV1SpeechStarted, ListenV1UtteranceEnd
from deepgram.speak.v1 import SpeakV1Flushed, SpeakV1Text
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.logging import logger

# Twilio Media Streams audio is always 8kHz mono mulaw -- fixed by Twilio's
# protocol, not a configuration choice, so these are module constants.
STT_ENCODING = "mulaw"
STT_SAMPLE_RATE = 8000
STT_CHANNELS = 1
TTS_ENCODING = "mulaw"
TTS_SAMPLE_RATE = "8000"  # Speak's streaming API types sample_rate as a string literal.

TranscriptCallback = Callable[[str, bool], Awaitable[None]]
VoidCallback = Callable[[], Awaitable[None]]
ErrorCallback = Callable[[Exception], Awaitable[None]]

_client: AsyncDeepgramClient | None = None


def get_deepgram_client() -> AsyncDeepgramClient:
    """Get the cached Deepgram client, authenticated with `DEEPGRAM_API_KEY`.

    Returns:
        AsyncDeepgramClient: A cached async Deepgram client.
    """
    global _client
    if _client is None:
        _client = AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
    return _client


class DeepgramSTTSession:
    """One Deepgram streaming-STT connection, held open for the lifetime of a call."""

    def __init__(self) -> None:
        """Initialize an unopened session; call `start()` to connect."""
        self._exit_stack = AsyncExitStack()
        self._socket = None
        self._listen_task: asyncio.Task[None] | None = None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=4), reraise=True)
    async def start(
        self,
        *,
        on_transcript: TranscriptCallback,
        on_utterance_end: VoidCallback,
        on_speech_started: VoidCallback,
        on_error: ErrorCallback,
    ) -> None:
        """Open the streaming connection and start consuming messages in the background.

        Retried only at connect time -- a live audio frame can't be
        meaningfully retried once a barge-in has already invalidated it, so
        nothing downstream of a successful connect is wrapped in retry.

        Args:
            on_transcript: Called with `(text, is_final)` for every non-empty transcript.
            on_utterance_end: Called when Deepgram signals the speaker has finished a turn.
            on_speech_started: Called when Deepgram's VAD detects new speech (barge-in signal).
            on_error: Called if the background message-consumer loop raises.
        """
        client = get_deepgram_client()
        connect_ctx = client.listen.v1.connect(
            model=settings.DEEPGRAM_STT_MODEL,
            encoding=STT_ENCODING,
            sample_rate=STT_SAMPLE_RATE,
            channels=STT_CHANNELS,
            interim_results=True,
            vad_events=True,
            endpointing=settings.DEEPGRAM_ENDPOINTING_MS,
            utterance_end_ms=settings.DEEPGRAM_UTTERANCE_END_MS,
        )
        self._socket = await self._exit_stack.enter_async_context(connect_ctx)
        logger.info("deepgram_stt_connected", model=settings.DEEPGRAM_STT_MODEL)
        self._listen_task = asyncio.create_task(
            self._consume(
                on_transcript=on_transcript,
                on_utterance_end=on_utterance_end,
                on_speech_started=on_speech_started,
                on_error=on_error,
            )
        )

    async def _consume(
        self,
        *,
        on_transcript: TranscriptCallback,
        on_utterance_end: VoidCallback,
        on_speech_started: VoidCallback,
        on_error: ErrorCallback,
    ) -> None:
        assert self._socket is not None
        try:
            async for message in self._socket:
                if isinstance(message, ListenV1Results):
                    alternatives = message.channel.alternatives
                    transcript = alternatives[0].transcript if alternatives else ""
                    if transcript:
                        is_final = bool(message.is_final)
                        logger.info("deepgram_stt_transcript_received", is_final=is_final, length=len(transcript))
                        await on_transcript(transcript, is_final)
                elif isinstance(message, ListenV1UtteranceEnd):
                    logger.info("deepgram_stt_utterance_end")
                    await on_utterance_end()
                elif isinstance(message, ListenV1SpeechStarted):
                    logger.info("deepgram_stt_speech_started")
                    await on_speech_started()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # connection dropped mid-call, or a malformed message
            logger.exception("deepgram_stt_error")
            await on_error(exc)

    async def send_audio(self, mulaw_chunk: bytes) -> None:
        """Forward one chunk of raw 8kHz mulaw audio to Deepgram.

        Args:
            mulaw_chunk: Raw mulaw-encoded audio bytes decoded from a Twilio `media` frame.
        """
        assert self._socket is not None
        await self._socket.send_media(mulaw_chunk)

    async def finish(self) -> None:
        """Close the stream cleanly and stop the background consumer task."""
        if self._socket is not None:
            try:
                await self._socket.send_close_stream()
            except Exception:
                logger.exception("deepgram_stt_close_failed")
        if self._listen_task is not None:
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task
        await self._exit_stack.aclose()
        logger.info("deepgram_stt_closed")


class DeepgramTTSSession:
    """Stateless per-turn TTS -- opens a fresh streaming connection for each synthesis call."""

    async def synthesize_stream(self, text: str) -> AsyncGenerator[bytes, None]:
        """Stream Aura TTS audio for `text` as raw 8kHz mulaw byte chunks.

        The streaming Speak websocket returns headerless raw audio bytes (no
        WAV/RIFF container), so chunks need no transcoding before being
        forwarded to Twilio -- only re-chunking/pacing (see `voice_runtime`).

        Args:
            text: The text to synthesize.

        Yields:
            bytes: Raw mulaw audio chunks as they arrive from Deepgram.
        """
        client = get_deepgram_client()
        logger.info("deepgram_tts_stream_started", model=settings.DEEPGRAM_TTS_MODEL)
        async with client.speak.v1.connect(
            model=settings.DEEPGRAM_TTS_MODEL,
            encoding=TTS_ENCODING,
            sample_rate=TTS_SAMPLE_RATE,
        ) as socket:
            await socket.send_text(SpeakV1Text(text=text))
            await socket.send_flush()
            async for message in socket:
                if isinstance(message, bytes):
                    yield message
                elif isinstance(message, SpeakV1Flushed):
                    break
        logger.info("deepgram_tts_stream_completed")
