"""Calendar availability + booking domain logic.

Sits between the Google HTTP client (``clients/google_client.py``) and the
callers that need scheduling (the internal voice endpoints). Two jobs:

- :func:`get_availability` — load the org's Google credential, refresh an access
  token, read free/busy, and turn it into a short list of open 30-minute slots
  during business hours in the org's timezone.
- :func:`book_meeting` — insert a calendar event for a chosen slot.

Slot math is factored into :func:`compute_open_slots`, a pure function (no I/O,
no clock) so it is exhaustively unit-testable. Everything time-relative is
computed from an injected ``now`` for the same reason.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.core.logging import logger
from app.services.clients.google_client import (
    BusyBlock,
    decrypt_refresh_token,
    insert_event,
    query_free_busy,
    refresh_access_token,
)
from app.services.clients.supabase_client import execute_query, get_service_role_client

# Sensible defaults (configurable per-org in a later pass — see the plan).
BUSINESS_START_HOUR = 9  # 9:00 local
BUSINESS_END_HOUR = 17  # 17:00 local
SLOT_MINUTES = 30
BOOKING_WINDOW_DAYS = 7  # look this many days ahead
MAX_SLOTS_RETURNED = 12  # keep the spoken list short


class CalendarNotConnectedError(Exception):
    """Raised when an org has no stored Google credential."""


@dataclass(frozen=True)
class TimeSlot:
    """An open bookable interval (timezone-aware)."""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class GoogleCredential:
    """An org's stored Google Calendar credential (decrypted refresh token)."""

    refresh_token: str
    calendar_id: str


@dataclass(frozen=True)
class BookedMeeting:
    """Result of a successful booking."""

    event_id: str
    html_link: str | None
    start: datetime
    end: datetime


def _parse_rfc3339(value: str) -> datetime:
    """Parse a Google RFC3339 timestamp, tolerating a trailing ``Z``."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _overlaps(slot_start: datetime, slot_end: datetime, busy: list[BusyBlock]) -> bool:
    """Whether a candidate slot intersects any busy block."""
    for block in busy:
        b_start = _parse_rfc3339(block.start)
        b_end = _parse_rfc3339(block.end)
        if slot_start < b_end and b_start < slot_end:
            return True
    return False


def compute_open_slots(
    *,
    now: datetime,
    tz: ZoneInfo,
    busy: list[BusyBlock],
    day_filter: set[int] | None = None,
    window_days: int = BOOKING_WINDOW_DAYS,
    slot_minutes: int = SLOT_MINUTES,
    max_slots: int = MAX_SLOTS_RETURNED,
) -> list[TimeSlot]:
    """Compute open business-hours slots, skipping busy blocks and the past.

    Pure: no I/O, no ambient clock. ``now`` anchors "the future" and the caller
    passes ``busy`` from a free/busy query. Weekends (Sat/Sun) are excluded.

    Args:
        now: Current instant (timezone-aware); slots before this are dropped.
        tz: Org timezone; business hours are interpreted in it.
        busy: Busy blocks to avoid (RFC3339 strings, any timezone).
        day_filter: When set, only include slots whose local weekday
            (Mon=0..Sun=6) is in this set — lets the agent honor "what days are
            you looking for?" without another calendar round-trip.
        window_days: How many days ahead to consider.
        slot_minutes: Slot length in minutes.
        max_slots: Cap on returned slots (keeps the spoken list short).

    Returns:
        list[TimeSlot]: Chronologically ordered open slots, at most ``max_slots``.
    """
    now_local = now.astimezone(tz)
    slots: list[TimeSlot] = []
    step = timedelta(minutes=slot_minutes)

    for day_offset in range(window_days):
        day = (now_local + timedelta(days=day_offset)).date()
        weekday = day.weekday()
        if weekday >= 5:  # Saturday/Sunday
            continue
        if day_filter is not None and weekday not in day_filter:
            continue

        cursor = datetime.combine(day, time(hour=BUSINESS_START_HOUR), tzinfo=tz)
        day_end = datetime.combine(day, time(hour=BUSINESS_END_HOUR), tzinfo=tz)
        while cursor + step <= day_end:
            slot_end = cursor + step
            if cursor >= now_local and not _overlaps(cursor, slot_end, busy):
                slots.append(TimeSlot(start=cursor, end=slot_end))
                if len(slots) >= max_slots:
                    return slots
            cursor = slot_end

    return slots


# Weekday names the voice agent may pass through, mapped to Python's Mon=0..Sun=6.
_WEEKDAY_NAMES = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def parse_weekdays(names: list[str]) -> set[int] | None:
    """Map spoken weekday names to a weekday-index set (Mon=0..Sun=6).

    Case-insensitive; unknown names are ignored. Returns ``None`` when nothing
    usable was supplied, which callers treat as "no day restriction".

    Args:
        names: Weekday names in any case (e.g. ``["Monday", "wed"]``).

    Returns:
        set[int] | None: Matching weekday indices, or ``None`` if empty.
    """
    matched: set[int] = set()
    for name in names:
        key = name.strip().lower()
        if key in _WEEKDAY_NAMES:
            matched.add(_WEEKDAY_NAMES[key])
            continue
        # Tolerate common abbreviations ("mon", "tues") by prefix match.
        for full, index in _WEEKDAY_NAMES.items():
            if len(key) >= 3 and full.startswith(key):
                matched.add(index)
                break
    return matched or None


def format_slot_label(slot_start: datetime) -> str:
    """Render a slot start as a spoken-friendly label the agent can read aloud.

    Example: ``"Monday, July 21 at 9:00 AM"``. Uses the datetime's own tzinfo,
    so pass an already-localized value.

    Args:
        slot_start: Timezone-aware slot start.

    Returns:
        str: A human-readable label with no leading zero on the hour.
    """
    hour = slot_start.strftime("%I").lstrip("0") or "12"
    return f"{slot_start.strftime('%A, %B %d')} at {hour}:{slot_start.strftime('%M %p')}"


async def _load_credential(org_id: str) -> GoogleCredential:
    """Load and decrypt an org's Google credential via the service-role client.

    Raises:
        CalendarNotConnectedError: If the org has not connected Google.
    """
    client = await get_service_role_client()
    response = await execute_query(
        client.table("organization_google_credentials")
        .select("refresh_token_encrypted, calendar_id")
        .eq("org_id", org_id)
        .maybe_single()
    )
    row = getattr(response, "data", None)
    if not row:
        raise CalendarNotConnectedError(f"org {org_id} has no connected google calendar")
    return GoogleCredential(
        refresh_token=decrypt_refresh_token(row["refresh_token_encrypted"]),
        calendar_id=row.get("calendar_id") or "primary",
    )


async def get_availability(
    *,
    org_id: str,
    timezone: str,
    now: datetime,
    day_filter: set[int] | None = None,
) -> list[TimeSlot]:
    """Return open slots for an org's connected calendar.

    Args:
        org_id: The organization whose calendar to read.
        timezone: IANA timezone name (from the org row).
        now: Current instant (injected for testability).
        day_filter: Optional weekday restriction (Mon=0..Sun=6).

    Returns:
        list[TimeSlot]: Open slots, possibly empty.

    Raises:
        CalendarNotConnectedError: If the org has not connected Google.
    """
    credential = await _load_credential(org_id)
    tz = ZoneInfo(timezone)
    access_token = await refresh_access_token(credential.refresh_token)
    window_end = now + timedelta(days=BOOKING_WINDOW_DAYS)
    busy = await query_free_busy(
        access_token,
        calendar_id=credential.calendar_id,
        time_min=now,
        time_max=window_end,
    )
    slots = compute_open_slots(now=now, tz=tz, busy=busy, day_filter=day_filter)
    logger.info("calendar_availability_computed", org_id=org_id, slots=len(slots), busy_blocks=len(busy))
    return slots


async def book_meeting(
    *,
    org_id: str,
    timezone: str,
    start: datetime,
    end: datetime,
    summary: str,
    location: str | None = None,
    description: str | None = None,
) -> BookedMeeting:
    """Insert a calendar event for a chosen slot.

    Args:
        org_id: The organization whose calendar to write.
        timezone: IANA timezone name for the event times.
        start: Chosen slot start (timezone-aware).
        end: Chosen slot end (timezone-aware).
        summary: Event title.
        location: Optional event location (the property address).
        description: Optional event description.

    Returns:
        BookedMeeting: The created event's id, link, and confirmed times.

    Raises:
        CalendarNotConnectedError: If the org has not connected Google.
    """
    credential = await _load_credential(org_id)
    access_token = await refresh_access_token(credential.refresh_token)
    event = await insert_event(
        access_token,
        calendar_id=credential.calendar_id,
        summary=summary,
        start=start,
        end=end,
        timezone=timezone,
        location=location,
        description=description,
    )
    logger.info("calendar_meeting_booked", org_id=org_id, event_id=event.get("id"))
    return BookedMeeting(
        event_id=str(event.get("id")),
        html_link=event.get("htmlLink"),
        start=start,
        end=end,
    )
