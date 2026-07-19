"""Unit tests for the calendar service's I/O orchestration.

``compute_open_slots`` is covered purely in ``test_calendar.py``; here we mock
the Google client + credential load to check ``get_availability`` and
``book_meeting`` wire the pieces together (token refresh → free/busy → slots,
and event insert) and that a missing credential raises the not-connected error.
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest

from app.services import calendar
from app.services.calendar import (
    BookedMeeting,
    CalendarNotConnectedError,
    GoogleCredential,
    book_meeting,
    get_availability,
)
from app.services.clients.google_client import BusyBlock

_LA = ZoneInfo("America/Los_Angeles")


def _credential() -> GoogleCredential:
    return GoogleCredential(refresh_token="refresh-abc", calendar_id="primary")


def test_get_availability_refreshes_token_and_returns_slots() -> None:
    now = datetime(2026, 7, 20, 9, 0, tzinfo=_LA)  # Monday
    with patch.object(calendar, "load_org_google_credential", new=AsyncMock(return_value=_credential())), patch.object(
        calendar, "refresh_access_token", new=AsyncMock(return_value="access-token")
    ) as refresh, patch.object(calendar, "query_free_busy", new=AsyncMock(return_value=[])) as free_busy:
        slots = asyncio.run(get_availability(org_id="org-1", timezone="America/Los_Angeles", now=now))

    refresh.assert_awaited_once_with("refresh-abc")
    free_busy.assert_awaited_once()
    assert slots
    assert slots[0].start == now


def test_get_availability_passes_busy_blocks_into_slot_math() -> None:
    now = datetime(2026, 7, 20, 9, 0, tzinfo=_LA)
    busy = [BusyBlock(start="2026-07-20T09:00:00-07:00", end="2026-07-20T10:00:00-07:00")]
    with patch.object(calendar, "load_org_google_credential", new=AsyncMock(return_value=_credential())), patch.object(
        calendar, "refresh_access_token", new=AsyncMock(return_value="access-token")
    ), patch.object(calendar, "query_free_busy", new=AsyncMock(return_value=busy)):
        slots = asyncio.run(get_availability(org_id="org-1", timezone="America/Los_Angeles", now=now))

    # 9:00 and 9:30 are busy → first open slot is 10:00.
    assert slots[0].start == datetime(2026, 7, 20, 10, 0, tzinfo=_LA)


def test_get_availability_raises_when_not_connected() -> None:
    with patch.object(
        calendar, "load_org_google_credential", new=AsyncMock(side_effect=CalendarNotConnectedError("org-1"))
    ):
        with pytest.raises(CalendarNotConnectedError):
            asyncio.run(
                get_availability(
                    org_id="org-1",
                    timezone="America/Los_Angeles",
                    now=datetime(2026, 7, 20, 9, 0, tzinfo=_LA),
                )
            )


def test_book_meeting_inserts_event_and_returns_result() -> None:
    start = datetime(2026, 7, 20, 9, 0, tzinfo=_LA)
    end = datetime(2026, 7, 20, 9, 30, tzinfo=_LA)
    insert = AsyncMock(return_value={"id": "evt-1", "htmlLink": "https://cal/evt-1"})
    with patch.object(calendar, "load_org_google_credential", new=AsyncMock(return_value=_credential())), patch.object(
        calendar, "refresh_access_token", new=AsyncMock(return_value="access-token")
    ), patch.object(calendar, "insert_event", new=insert):
        result = asyncio.run(
            book_meeting(
                org_id="org-1",
                timezone="America/Los_Angeles",
                start=start,
                end=end,
                summary="Showing at 123 Main St",
                location="123 Main St",
            )
        )

    assert isinstance(result, BookedMeeting)
    assert result.event_id == "evt-1"
    assert result.html_link == "https://cal/evt-1"
    _, kwargs = insert.call_args
    assert kwargs["location"] == "123 Main St"
    assert kwargs["summary"] == "Showing at 123 Main St"
    assert kwargs["calendar_id"] == "primary"
