"""Unit tests for LiveKit voice TwiML + room URI helpers."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.clients.livekit_client import prepare_inbound_voice_room, voice_room_name, voice_sip_uri
from app.services.clients.twilio_client import (
    generate_voice_answer_twiml,
    generate_voice_reject_twiml,
)


def test_generate_voice_answer_twiml_dials_livekit_sip() -> None:
    twiml = generate_voice_answer_twiml(
        sip_uri="sip:call-CA123@example.sip.livekit.cloud;transport=tcp",
        sip_username="trunk-user",
        sip_password="trunk-pass",  # pragma: allowlist secret
    )

    assert "<Dial" in twiml
    assert "answerOnBridge" in twiml
    assert "sip:call-CA123@example.sip.livekit.cloud;transport=tcp" in twiml
    assert 'username="trunk-user"' in twiml
    assert 'password="trunk-pass"' in twiml  # pragma: allowlist secret


def test_generate_voice_answer_twiml_without_sip_auth() -> None:
    twiml = generate_voice_answer_twiml(sip_uri="sip:call-CA123@example.sip.livekit.cloud;transport=tcp")

    assert "<Sip>sip:call-CA123@example.sip.livekit.cloud;transport=tcp</Sip>" in twiml
    assert "username=" not in twiml


def test_generate_voice_reject_twiml_says_and_hangs_up() -> None:
    twiml = generate_voice_reject_twiml(message="We are unable to take your call.")

    assert "<Say>We are unable to take your call.</Say>" in twiml
    assert "<Hangup" in twiml


def test_voice_room_name_and_sip_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_SIP_HOST", "proj.sip.livekit.cloud")
    assert voice_room_name("CA123") == "call-CA123"
    assert voice_sip_uri("call-CA123") == "sip:call-CA123@proj.sip.livekit.cloud;transport=tcp"


def test_prepare_inbound_voice_room_creates_room_and_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_SIP_HOST", "proj.sip.livekit.cloud")
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_AGENT_NAME", "mirenta-voice")
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_ROOM_EMPTY_TIMEOUT_SECONDS", 60)

    fake_lk = MagicMock()
    fake_lk.room.create_room = AsyncMock()
    fake_lk.agent_dispatch.create_dispatch = AsyncMock()
    monkeypatch.setattr("app.services.clients.livekit_client._livekit_api", lambda: fake_lk)

    prepared = asyncio.run(
        prepare_inbound_voice_room(
            call_sid="CA123",
            org_id="org-1",
            contact_id="contact-1",
            signal_id="signal-1",
        )
    )

    assert prepared.room_name == "call-CA123"
    assert prepared.sip_uri == "sip:call-CA123@proj.sip.livekit.cloud;transport=tcp"
    fake_lk.room.create_room.assert_awaited_once()
    fake_lk.agent_dispatch.create_dispatch.assert_awaited_once()
