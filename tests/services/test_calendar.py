"""Unit tests for calendar slot math and spoken-label formatting.

These target the pure functions in ``app/services/calendar.py`` — no I/O, no
ambient clock (``now`` is injected), so they are exhaustively deterministic.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.services.clients.google_client import BusyBlock
from app.services.calendar import (
    DEFAULT_END_HOUR,
    DEFAULT_START_HOUR,
    SLOT_MINUTES,
    clamp_slot_minutes,
    compute_open_slots,
    format_slot_label,
    parse_weekdays,
    resolve_hour_window,
)

_LA = ZoneInfo("America/Los_Angeles")


def _monday_9am() -> datetime:
    # 2026-07-20 is a Monday.
    return datetime(2026, 7, 20, 9, 0, tzinfo=_LA)


def _monday_midnight() -> datetime:
    return datetime(2026, 7, 20, 0, 0, tzinfo=_LA)


def test_compute_open_slots_fills_the_default_daytime_band() -> None:
    # A vague "what's open?" stays inside the default 9–17 band, not 24 hours.
    now = _monday_midnight()
    slots = compute_open_slots(now=now, tz=_LA, busy=[], window_days=1, max_slots=1000)
    expected = (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 60 // SLOT_MINUTES
    assert len(slots) == expected
    assert slots[0].start == datetime(2026, 7, 20, DEFAULT_START_HOUR, 0, tzinfo=_LA)
    assert slots[-1].end == datetime(2026, 7, 20, DEFAULT_END_HOUR, 0, tzinfo=_LA)


def test_compute_open_slots_excludes_off_hours_by_default() -> None:
    # Without an explicit window, early morning and evening are not offered.
    now = _monday_midnight()
    slots = compute_open_slots(now=now, tz=_LA, busy=[], window_days=1, max_slots=1000)
    starts = {slot.start for slot in slots}
    assert datetime(2026, 7, 20, 6, 0, tzinfo=_LA) not in starts  # early morning
    assert datetime(2026, 7, 20, 20, 0, tzinfo=_LA) not in starts  # evening


def test_compute_open_slots_honors_explicit_early_window() -> None:
    # The caller asking about 6am reaches outside the default band.
    now = _monday_midnight()
    slots = compute_open_slots(
        now=now, tz=_LA, busy=[], hour_window=(6, 9), window_days=1, max_slots=1000
    )
    assert slots[0].start == datetime(2026, 7, 20, 6, 0, tzinfo=_LA)
    assert slots[-1].end == datetime(2026, 7, 20, 9, 0, tzinfo=_LA)


def test_compute_open_slots_honors_late_window_to_midnight() -> None:
    # end_hour==24 walks up to midnight without a time(hour=24) error.
    now = _monday_midnight()
    slots = compute_open_slots(
        now=now, tz=_LA, busy=[], hour_window=(22, 24), window_days=1, max_slots=1000
    )
    assert slots[0].start == datetime(2026, 7, 20, 22, 0, tzinfo=_LA)
    assert slots[-1].end == datetime(2026, 7, 21, 0, 0, tzinfo=_LA)


def test_compute_open_slots_skips_past_slots() -> None:
    now = datetime(2026, 7, 20, 12, 15, tzinfo=_LA)  # mid-day
    slots = compute_open_slots(now=now, tz=_LA, busy=[], window_days=1, max_slots=100)
    # First slot must start at or after now; the 12:00 slot is in the past.
    assert all(slot.start >= now for slot in slots)
    assert slots[0].start == datetime(2026, 7, 20, 12, 30, tzinfo=_LA)


def test_compute_open_slots_offers_weekends_within_the_band() -> None:
    # Availability is a free/busy binary across all days; weekends are offered,
    # still bounded by the daytime band.
    friday = datetime(2026, 7, 24, 9, 0, tzinfo=_LA)
    slots = compute_open_slots(now=friday, tz=_LA, busy=[], window_days=4, max_slots=1000)
    weekdays = {slot.start.weekday() for slot in slots}
    assert 5 in weekdays  # Saturday
    assert 6 in weekdays  # Sunday
    assert all(DEFAULT_START_HOUR <= slot.start.hour < DEFAULT_END_HOUR for slot in slots)


def test_compute_open_slots_avoids_busy_blocks() -> None:
    now = _monday_9am()
    # Busy 9:00–10:00 UTC-7 → blocks the first two 30-min slots.
    busy = [BusyBlock(start="2026-07-20T09:00:00-07:00", end="2026-07-20T10:00:00-07:00")]
    slots = compute_open_slots(now=now, tz=_LA, busy=busy, window_days=1, max_slots=100)
    assert slots[0].start == datetime(2026, 7, 20, 10, 0, tzinfo=_LA)
    assert all(not (slot.start < datetime(2026, 7, 20, 10, 0, tzinfo=_LA)) for slot in slots)


def test_compute_open_slots_honors_day_filter() -> None:
    now = _monday_9am()
    # Only Wednesday (weekday 2) within a 5-day window.
    slots = compute_open_slots(now=now, tz=_LA, busy=[], day_filter={2}, window_days=5, max_slots=100)
    assert slots
    assert {slot.start.weekday() for slot in slots} == {2}


def test_compute_open_slots_respects_max_slots() -> None:
    now = _monday_9am()
    slots = compute_open_slots(now=now, tz=_LA, busy=[], window_days=5, max_slots=3)
    assert len(slots) == 3


def test_compute_open_slots_honors_sixty_minute_length() -> None:
    now = _monday_midnight()
    slots = compute_open_slots(now=now, tz=_LA, busy=[], window_days=1, slot_minutes=60, max_slots=1000)
    # One slot per hour across the default 9–17 band.
    assert len(slots) == DEFAULT_END_HOUR - DEFAULT_START_HOUR
    assert slots[0].start == datetime(2026, 7, 20, DEFAULT_START_HOUR, 0, tzinfo=_LA)
    assert slots[0].end == datetime(2026, 7, 20, DEFAULT_START_HOUR + 1, 0, tzinfo=_LA)


def test_clamp_slot_minutes_defaults_and_bounds() -> None:
    assert clamp_slot_minutes(None) == SLOT_MINUTES  # nothing requested → default
    assert clamp_slot_minutes(0) == SLOT_MINUTES  # falsy → default
    assert clamp_slot_minutes(45) == 45  # in-band passes through
    assert clamp_slot_minutes(60) == 60  # upper edge allowed
    assert clamp_slot_minutes(15) == 30  # below floor clamps up
    assert clamp_slot_minutes(120) == 60  # above ceiling clamps down


def test_resolve_hour_window_defaults_and_overrides() -> None:
    assert resolve_hour_window(None, None) == (DEFAULT_START_HOUR, DEFAULT_END_HOUR)
    assert resolve_hour_window(6, None) == (6, DEFAULT_END_HOUR)  # early override only
    assert resolve_hour_window(None, 21) == (DEFAULT_START_HOUR, 21)  # late override only
    assert resolve_hour_window(6, 8) == (6, 8)  # both named
    assert resolve_hour_window(-3, 30) == (0, 24)  # coerced into 0..24
    # A degenerate window (end <= start) is widened to a single usable hour.
    assert resolve_hour_window(15, 15) == (15, 16)


def test_parse_weekdays_maps_names_and_abbreviations() -> None:
    assert parse_weekdays(["Monday", "wed"]) == {0, 2}
    assert parse_weekdays(["FRIDAY"]) == {4}


def test_parse_weekdays_ignores_unknown_and_empty() -> None:
    assert parse_weekdays([]) is None
    assert parse_weekdays(["someday", "x"]) is None


def test_format_slot_label_is_spoken_friendly() -> None:
    label = format_slot_label(datetime(2026, 7, 20, 9, 0, tzinfo=_LA))
    assert label == "Monday, July 20 at 9:00 AM"


def test_format_slot_label_afternoon_no_leading_zero() -> None:
    label = format_slot_label(datetime(2026, 7, 20, 13, 30, tzinfo=timezone.utc))
    assert label == "Monday, July 20 at 1:30 PM"
