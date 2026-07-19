"""Unit tests for the /internal/voice/send-email endpoint.

Uses ``TestClient(app)`` for real ASGI routing/auth and patches only the router
boundary (service-role client, execute_query, send_org_email). Nothing hits a
live Google account or database.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.email import GoogleNotConnectedError

_ORG_ID = "11111111-1111-1111-1111-111111111111"
_CONTACT_ID = "22222222-2222-2222-2222-222222222222"
_URL = f"{settings.API_PREFIX}/internal/voice/send-email"
_KEY_HEADER = {"X-Mirenta-Internal-Key": "test-internal-key"}


def _base_body(**overrides) -> dict:
    body = {
        "org_id": _ORG_ID,
        "contact_id": _CONTACT_ID,
        "subject": "Your meeting is confirmed",
        "body": "See you Monday at 9:00 AM.",
        "to": "caller@example.com",
    }
    body.update(overrides)
    return body


def test_send_email_requires_internal_key() -> None:
    client = TestClient(app)
    response = client.post(_URL, json=_base_body())
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_internal_api_key"


def test_send_email_sends_to_explicit_recipient() -> None:
    send = AsyncMock()
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch("app.api.routers.voice.send_org_email", send),
    ):
        response = client.post(_URL, json=_base_body(), headers=_KEY_HEADER)

    assert response.status_code == 200
    payload = response.json()
    assert payload == {"sent": True, "connected": True, "to": "caller@example.com"}
    _, kwargs = send.call_args
    assert kwargs["to"] == "caller@example.com"
    assert kwargs["org_id"] == _ORG_ID


def test_send_email_falls_back_to_contact_email_on_file() -> None:
    send = AsyncMock()
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice.execute_query",
            AsyncMock(return_value=SimpleNamespace(data={"email": "onfile@example.com"})),
        ),
        patch("app.api.routers.voice.send_org_email", send),
    ):
        response = client.post(_URL, json=_base_body(to=None), headers=_KEY_HEADER)

    assert response.status_code == 200
    assert response.json()["to"] == "onfile@example.com"
    _, kwargs = send.call_args
    assert kwargs["to"] == "onfile@example.com"


def test_send_email_returns_no_recipient_when_none_available() -> None:
    send = AsyncMock()
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice.execute_query",
            AsyncMock(return_value=SimpleNamespace(data={"email": None})),
        ),
        patch("app.api.routers.voice.send_org_email", send),
    ):
        response = client.post(_URL, json=_base_body(to=None), headers=_KEY_HEADER)

    assert response.status_code == 200
    assert response.json() == {"sent": False, "connected": True, "to": None}
    send.assert_not_awaited()


def test_send_email_reports_not_connected() -> None:
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice.send_org_email",
            AsyncMock(side_effect=GoogleNotConnectedError("org-1")),
        ),
    ):
        response = client.post(_URL, json=_base_body(), headers=_KEY_HEADER)

    assert response.status_code == 200
    assert response.json() == {"sent": False, "connected": False, "to": "caller@example.com"}
