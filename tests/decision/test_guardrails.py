"""Unit tests for decision/guardrails.py — pure functions, no clock/DB needed."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from decision.guardrails import (
    check_consent,
    check_dnc,
    check_frequency_cap,
    is_quiet_hours,
    next_allowed_send_time,
)
from tests.decision.factories import make_contact, make_contact_state, make_current_consent


def test_check_dnc_blocks_when_status_dnc() -> None:
    contact = make_contact(status="dnc")
    denial = check_dnc(contact)
    assert denial is not None
    assert denial.check == "dnc"


def test_check_dnc_allows_when_active() -> None:
    contact = make_contact(status="active")
    assert check_dnc(contact) is None


def test_check_consent_default_allow_when_none() -> None:
    assert check_consent(None, "sms") is None


def test_check_consent_blocks_when_granted_false() -> None:
    consent = make_current_consent(granted=False)
    denial = check_consent(consent, "sms")
    assert denial is not None
    assert denial.check == "consent"


def test_check_consent_allows_when_granted_true() -> None:
    consent = make_current_consent(granted=True)
    assert check_consent(consent, "sms") is None


def test_check_frequency_cap_blocks_within_window() -> None:
    now = datetime.now(timezone.utc)
    state = make_contact_state(contact_attempts=3, attempts_window_start=now - timedelta(hours=1))
    denial = check_frequency_cap(state, now)
    assert denial is not None
    assert denial.check == "frequency_cap"


def test_check_frequency_cap_allows_after_window_expires() -> None:
    now = datetime.now(timezone.utc)
    state = make_contact_state(contact_attempts=3, attempts_window_start=now - timedelta(hours=25))
    assert check_frequency_cap(state, now) is None


def test_check_frequency_cap_allows_when_under_cap() -> None:
    now = datetime.now(timezone.utc)
    state = make_contact_state(contact_attempts=1, attempts_window_start=now - timedelta(hours=1))
    assert check_frequency_cap(state, now) is None


@pytest.mark.parametrize("tz_name", ["America/Los_Angeles", "Asia/Tokyo"])
def test_next_allowed_send_time_defers_during_quiet_hours(tz_name: str) -> None:
    contact = make_contact(timezone_name=tz_name)
    # 10pm local -- squarely inside the 9pm-8am quiet-hours window.
    local_evening = datetime(2026, 7, 10, 22, 0, tzinfo=ZoneInfo(tz_name))
    now = local_evening.astimezone(timezone.utc)

    assert is_quiet_hours(contact, now) is True

    deferred = next_allowed_send_time(contact, now)
    assert deferred > now

    deferred_local = deferred.astimezone(ZoneInfo(tz_name))
    assert deferred_local.hour == 8
    assert deferred_local.date() == local_evening.date() + timedelta(days=1)


@pytest.mark.parametrize("tz_name", ["America/Los_Angeles", "Asia/Tokyo"])
def test_next_allowed_send_time_unchanged_outside_quiet_hours(tz_name: str) -> None:
    contact = make_contact(timezone_name=tz_name)
    # 2pm local -- squarely outside quiet hours.
    local_afternoon = datetime(2026, 7, 10, 14, 0, tzinfo=ZoneInfo(tz_name))
    now = local_afternoon.astimezone(timezone.utc)

    assert is_quiet_hours(contact, now) is False
    assert next_allowed_send_time(contact, now) == now
