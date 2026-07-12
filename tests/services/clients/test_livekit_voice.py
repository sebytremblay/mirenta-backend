"""Unit tests for LiveKit voice TwiML + SIP URI helpers."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.clients.livekit_client import prepare_inbound_voice_room, voice_sip_uri
from app.services.clients.twilio_client import (
    generate_voice_answer_twiml,
    generate_voice_reject_twiml,
)


def test_bootstrap_binds_json_body_not_query() -> None:
    """Regression: future annotations + slowapi once treated the body as a query param (422)."""
    client = TestClient(app)
    response = client.post(
        f"{settings.API_PREFIX}/internal/voice/bootstrap",
        json={
            "org_id": "org-1",
            "contact_id": "contact-1",
            "signal_id": "signal-1",
            "call_sid": "CA123",
            "room_name": "call-CA123",
        },
    )
    # Auth runs after body parsing — 401 means the JSON body was accepted.
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_internal_api_key"


def test_generate_voice_answer_twiml_dials_livekit_sip() -> None:
    twiml = generate_voice_answer_twiml(
        sip_uri="sip:+15551234567@example.sip.livekit.cloud;transport=tcp",
        sip_username="trunk-user",
        sip_password="trunk-pass",  # pragma: allowlist secret
    )

    assert "<Dial" in twiml
    assert "answerOnBridge" in twiml
    assert "sip:+15551234567@example.sip.livekit.cloud;transport=tcp" in twiml
    assert 'username="trunk-user"' in twiml
    assert 'password="trunk-pass"' in twiml  # pragma: allowlist secret


def test_generate_voice_answer_twiml_without_sip_auth() -> None:
    twiml = generate_voice_answer_twiml(sip_uri="sip:+15551234567@example.sip.livekit.cloud;transport=tcp")

    assert "<Sip>sip:+15551234567@example.sip.livekit.cloud;transport=tcp</Sip>" in twiml
    assert "username=" not in twiml


def test_generate_voice_reject_twiml_says_and_hangs_up() -> None:
    twiml = generate_voice_reject_twiml(message="We are unable to take your call.")

    assert "<Say>We are unable to take your call.</Say>" in twiml
    assert "<Hangup" in twiml


def test_voice_sip_uri_dials_e164_with_mirenta_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_SIP_HOST", "proj.sip.livekit.cloud")
    uri = voice_sip_uri(
        dialed_number="+15551234567",
        org_id="org-1",
        contact_id="contact-1",
        signal_id="signal-1",
        call_sid="CA123",
    )
    assert uri.startswith("sip:+15551234567@proj.sip.livekit.cloud;transport=tcp?")
    assert "x-mirenta-org-id=org-1" in uri
    assert "x-mirenta-contact-id=contact-1" in uri
    assert "x-mirenta-signal-id=signal-1" in uri
    assert "x-mirenta-call-sid=CA123" in uri


def test_prepare_inbound_voice_room_builds_sip_uri(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_SIP_HOST", "proj.sip.livekit.cloud")
    monkeypatch.setattr("app.services.clients.livekit_client.settings.LIVEKIT_AGENT_NAME", "mirenta-voice")

    prepared = prepare_inbound_voice_room(
        call_sid="CA123",
        org_id="org-1",
        contact_id="contact-1",
        signal_id="signal-1",
        to_number="15551234567",
    )

    assert prepared.dialed_number == "+15551234567"
    assert prepared.sip_uri.startswith("sip:+15551234567@proj.sip.livekit.cloud;transport=tcp?")
    assert "x-mirenta-call-sid=CA123" in prepared.sip_uri
