"""Unit tests for LiveKit agent bootstrap binding and the Twilio voice webhook's SIP dial bridge."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from httpx import Response

from app.core.config import settings
from app.main import app
from app.services.clients.twilio_client import generate_voice_reject_twiml

_ORG_ID = "11111111-1111-1111-1111-111111111111"
_CONTACT_ID = "22222222-2222-2222-2222-222222222222"
_SIGNAL_ID = "33333333-3333-3333-3333-333333333333"
_CALL_SID = "CA123"


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


def test_generate_voice_reject_twiml_says_and_hangs_up() -> None:
    twiml = generate_voice_reject_twiml(message="We are unable to take your call.")

    assert "<Say>We are unable to take your call.</Say>" in twiml
    assert "<Hangup" in twiml


def _contact_row() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": _CONTACT_ID,
        "org_id": _ORG_ID,
        "phone": "+15557654321",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }


def _signal_row() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": _SIGNAL_ID,
        "org_id": _ORG_ID,
        "contact_id": _CONTACT_ID,
        "type": "inbound_call",
        "channel": "voice",
        "source": "twilio",
        "dedup_key": _CALL_SID,
        "payload": {},
        "raw_payload": {},
        "status": "received",
        "received_at": now,
    }


def _post_voice_webhook() -> tuple[Response, AsyncMock]:
    client = TestClient(app)
    with (
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch("app.api.routers.voice.validate_twilio_signature", AsyncMock(return_value=True)),
        patch("app.api.routers.voice.find_org_by_phone", AsyncMock(return_value={"id": _ORG_ID})),
        patch("app.api.routers.voice.get_or_create_contact_by_phone", AsyncMock(return_value=_contact_row())),
        patch(
            "app.api.routers.voice.execute_query",
            AsyncMock(return_value=SimpleNamespace(data=[_signal_row()])),
        ),
        patch("app.api.routers.voice.get_current_consent", AsyncMock(return_value=None)),
        patch("app.api.routers.voice.mark_signal_status", AsyncMock()) as mark_signal_status,
    ):
        response = client.post(
            f"{settings.API_PREFIX}/webhooks/twilio/voice",
            data={"From": "+15557654321", "To": "+15551234567", "CallSid": _CALL_SID},
        )
    return response, mark_signal_status


def test_receive_twilio_call_dials_into_livekit_sip_when_configured() -> None:
    with patch.object(settings, "LIVEKIT_SIP_URI", "mirenta-y0dc1n3g.sip.livekit.cloud"):
        response, mark_signal_status = _post_voice_webhook()

    assert response.status_code == 200
    assert "<Dial" in response.text
    assert "sip:mirenta-y0dc1n3g.sip.livekit.cloud;transport=tcp" in response.text
    assert f"X-Mirenta-Call-Sid={_CALL_SID}" in response.text
    mark_signal_status.assert_awaited_once_with(ANY, _SIGNAL_ID, "delivered")


def test_receive_twilio_call_rejects_when_sip_uri_not_configured() -> None:
    with patch.object(settings, "LIVEKIT_SIP_URI", ""):
        response, mark_signal_status = _post_voice_webhook()

    assert response.status_code == 200
    assert "<Dial" not in response.text
    assert "<Hangup" in response.text
    mark_signal_status.assert_awaited_once_with(ANY, _SIGNAL_ID, "ignored")
