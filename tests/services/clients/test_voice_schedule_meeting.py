"""Unit tests for the /internal/voice/schedule-meeting endpoint.

Booking sends the confirmation email itself (built in, not a separate tool).
Uses ``TestClient(app)`` for real ASGI routing/auth and patches only the router
boundary (service-role client, org load, calendar booking, email send, and the
meeting-scheduled signal). Nothing hits a live Google account or database.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.calendar import BookedMeeting
from app.services.email import GoogleNotConnectedError

_ORG_ID = "11111111-1111-1111-1111-111111111111"
_CONTACT_ID = "22222222-2222-2222-2222-222222222222"
_URL = f"{settings.API_PREFIX}/internal/voice/schedule-meeting"
_KEY_HEADER = {"X-Mirenta-Internal-Key": "test-internal-key"}


def _base_body(**overrides) -> dict:
    body = {
        "org_id": _ORG_ID,
        "contact_id": _CONTACT_ID,
        "start": "2026-07-20T09:00:00-07:00",
        "end": "2026-07-20T09:30:00-07:00",
        "location": "123 Main St",
        "email": "caller@example.com",
    }
    body.update(overrides)
    return body


def _booked() -> BookedMeeting:
    from datetime import datetime, timezone

    start = datetime(2026, 7, 20, 16, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 20, 16, 30, tzinfo=timezone.utc)
    return BookedMeeting(event_id="evt-1", html_link="https://cal/evt-1", start=start, end=end)


def test_schedule_meeting_requires_internal_key() -> None:
    client = TestClient(app)
    response = client.post(_URL, json=_base_body())
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid_internal_api_key"


def test_schedule_meeting_books_and_emails_confirmation() -> None:
    send = AsyncMock()
    emit = AsyncMock()
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice._load_org_for_scheduling",
            AsyncMock(return_value={"name": "Acme Realty", "timezone": "America/Los_Angeles"}),
        ),
        patch("app.api.routers.voice.book_meeting", AsyncMock(return_value=_booked())),
        patch("app.api.routers.voice.send_org_email", send),
        patch("app.api.routers.voice.emit_meeting_scheduled_signal", emit),
    ):
        response = client.post(_URL, json=_base_body(), headers=_KEY_HEADER)

    assert response.status_code == 200
    payload = response.json()
    assert payload["booked"] is True
    assert payload["email_sent"] is True
    assert payload["email_to"] == "caller@example.com"
    # Confirmation email goes to the address the agent captured on the call.
    _, kwargs = send.call_args
    assert kwargs["to"] == "caller@example.com"
    assert "Acme Realty" in kwargs["subject"]
    # Booking re-enters the loop so the follow-up email gets scheduled.
    emit.assert_awaited_once()


def test_schedule_meeting_falls_back_to_contact_email_on_file() -> None:
    send = AsyncMock()
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice._load_org_for_scheduling",
            AsyncMock(return_value={"name": "Acme Realty", "timezone": "America/Los_Angeles"}),
        ),
        patch("app.api.routers.voice.book_meeting", AsyncMock(return_value=_booked())),
        patch(
            "app.api.routers.voice.execute_query",
            AsyncMock(return_value=SimpleNamespace(data={"email": "onfile@example.com"})),
        ),
        patch("app.api.routers.voice.send_org_email", send),
        patch("app.api.routers.voice.emit_meeting_scheduled_signal", AsyncMock()),
    ):
        response = client.post(_URL, json=_base_body(email=None), headers=_KEY_HEADER)

    assert response.status_code == 200
    assert response.json()["email_to"] == "onfile@example.com"
    _, kwargs = send.call_args
    assert kwargs["to"] == "onfile@example.com"


def test_schedule_meeting_books_even_when_email_not_connected() -> None:
    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice._load_org_for_scheduling",
            AsyncMock(return_value={"name": "Acme Realty", "timezone": "America/Los_Angeles"}),
        ),
        patch("app.api.routers.voice.book_meeting", AsyncMock(return_value=_booked())),
        patch(
            "app.api.routers.voice.send_org_email",
            AsyncMock(side_effect=GoogleNotConnectedError("org-1")),
        ),
        patch("app.api.routers.voice.emit_meeting_scheduled_signal", AsyncMock()),
    ):
        response = client.post(_URL, json=_base_body(), headers=_KEY_HEADER)

    assert response.status_code == 200
    payload = response.json()
    # The calendar event stands even though the confirmation could not send.
    assert payload["booked"] is True
    assert payload["email_sent"] is False
    assert payload["email_to"] == "caller@example.com"


def test_schedule_meeting_reports_not_connected_calendar() -> None:
    from app.services.calendar import CalendarNotConnectedError

    client = TestClient(app)
    with (
        patch.object(settings, "MIRENTA_INTERNAL_API_KEY", "test-internal-key"),
        patch("app.api.routers.voice.get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch(
            "app.api.routers.voice._load_org_for_scheduling",
            AsyncMock(return_value={"name": "Acme Realty", "timezone": "America/Los_Angeles"}),
        ),
        patch(
            "app.api.routers.voice.book_meeting",
            AsyncMock(side_effect=CalendarNotConnectedError("org-1")),
        ),
    ):
        response = client.post(_URL, json=_base_body(), headers=_KEY_HEADER)

    assert response.status_code == 200
    assert response.json() == {
        "booked": False,
        "connected": False,
        "start": None,
        "end": None,
        "email_sent": False,
        "email_to": None,
        "label": None,
    }
