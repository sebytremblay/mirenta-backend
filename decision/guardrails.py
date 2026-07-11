"""Compliance guardrails — frequency caps, DNC, consent, plus quiet-hours helpers.

Hard blocks (`run_hard_guardrails`): DNC, consent, frequency cap.
Quiet-hours helpers (`is_quiet_hours`, `next_allowed_send_time`) defer
proactive/outbound outreach (including the 3-day silence follow-up).
Inbound replies still schedule immediately.

Pure functions: no I/O, no `datetime.now()` calls (callers always pass `now`
explicitly) — this is what keeps the module both unit-testable without a
clock and safe to call directly from Temporal workflow code, which must use
`workflow.now()` rather than a wall-clock read for replay-determinism.
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from app.schemas.contacts import Channel, Contact, ContactState, CurrentConsent

QUIET_HOURS_START = time(21, 0)  # 9pm contact-local
QUIET_HOURS_END = time(8, 0)  # 8am contact-local
FREQUENCY_CAP_MAX_ATTEMPTS = 3
FREQUENCY_CAP_WINDOW = timedelta(hours=24)


class GuardrailDenial(BaseModel):
    """A hard-block guardrail failure — the caller never emits/executes the task."""

    check: str  # "dnc" | "consent" | "frequency_cap"
    detail: str


def _local_time(contact: Contact, now: datetime) -> datetime:
    """Convert a UTC-aware `now` to the contact's IANA-timezone-local time."""
    return now.astimezone(ZoneInfo(contact.timezone))


def is_quiet_hours(contact: Contact, now: datetime) -> bool:
    """Whether `now`, converted to the contact's local time, falls in quiet hours (9pm-8am)."""
    local_time = _local_time(contact, now).time()
    return local_time >= QUIET_HOURS_START or local_time < QUIET_HOURS_END


def next_allowed_send_time(contact: Contact, now: datetime) -> datetime:
    """The next time (in UTC) it's safe to send, honoring quiet hours.

    For *proactive/outbound-initiated* outreach only. Inbound replies
    schedule immediately — the contact is already awake. Quiet hours is a
    scheduling deferral, not a hard emission-block; DNC, consent, and the
    frequency cap (see `run_hard_guardrails`) are the true hard blocks.
    Unused by inbound-reply rules; used by the 3-day silence follow-up
    (and future proactive outreach) so delayed sends don't fire at 1am.
    """
    if not is_quiet_hours(contact, now):
        return now
    local = _local_time(contact, now)
    next_date = local.date() if local.time() < QUIET_HOURS_END else local.date() + timedelta(days=1)
    next_local = datetime.combine(next_date, QUIET_HOURS_END, tzinfo=local.tzinfo)
    return next_local.astimezone(timezone.utc)


def check_dnc(contact: Contact) -> GuardrailDenial | None:
    """Blocks if the contact is on the do-not-contact list."""
    if contact.status == "dnc":
        return GuardrailDenial(check="dnc", detail=f"contact {contact.id} is on the do-not-contact list")
    return None


def check_consent(consent: CurrentConsent | None, channel: Channel) -> GuardrailDenial | None:
    """Blocks only on an explicit revoke; `consent is None` is default-allow.

    Matches the default-true semantics `app/services/sms_interaction.py`'s
    `_has_sms_consent` already relies on today.
    """
    if consent is not None and not consent.granted:
        return GuardrailDenial(check="consent", detail=f"consent revoked for channel {channel}")
    return None


def check_frequency_cap(contact_state: ContactState, now: datetime) -> GuardrailDenial | None:
    """Blocks if the contact has hit the attempt cap within the rolling window."""
    if contact_state.attempts_window_start is None:
        return None
    if contact_state.contact_attempts < FREQUENCY_CAP_MAX_ATTEMPTS:
        return None
    if now - contact_state.attempts_window_start >= FREQUENCY_CAP_WINDOW:
        return None
    return GuardrailDenial(
        check="frequency_cap",
        detail=f"{contact_state.contact_attempts} attempts within the last {FREQUENCY_CAP_WINDOW}",
    )


def run_hard_guardrails(
    *,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    channel: Channel,
    now: datetime,
) -> list[GuardrailDenial]:
    """DNC, consent, and frequency-cap — hard blocks on task emission/execution."""
    denials = [
        check_dnc(contact),
        check_consent(consent, channel),
        check_frequency_cap(contact_state, now),
    ]
    return [denial for denial in denials if denial is not None]
