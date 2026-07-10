"""Test-only factory helpers for building minimal valid schema instances."""

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from app.schemas.contacts import Channel, Contact, ContactState, ContactStatus, CurrentConsent
from app.schemas.signals import Signal, SignalType


def make_contact(
    *, status: ContactStatus = "active", timezone_name: str = "America/Los_Angeles", **overrides: Any
) -> Contact:
    now = datetime.now(timezone.utc)
    return Contact(
        id=overrides.pop("id", uuid4()),
        org_id=overrides.pop("org_id", uuid4()),
        phone="+15555550100",
        timezone=timezone_name,
        status=status,
        created_at=now,
        updated_at=now,
        **overrides,
    )


def make_contact_state(
    *,
    contact_id: UUID | None = None,
    org_id: UUID | None = None,
    contact_attempts: int = 0,
    attempts_window_start: datetime | None = None,
    **overrides: Any,
) -> ContactState:
    return ContactState(
        contact_id=contact_id or uuid4(),
        org_id=org_id or uuid4(),
        contact_attempts=contact_attempts,
        attempts_window_start=attempts_window_start,
        updated_at=datetime.now(timezone.utc),
        **overrides,
    )


def make_signal(
    *, type: SignalType = "inbound_sms", payload: dict[str, Any] | None = None, **overrides: Any
) -> Signal:
    return Signal(
        id=overrides.pop("id", uuid4()),
        org_id=overrides.pop("org_id", uuid4()),
        type=type,
        payload=payload or {},
        received_at=datetime.now(timezone.utc),
        **overrides,
    )


def make_current_consent(*, granted: bool, channel: Channel = "sms", **overrides: Any) -> CurrentConsent:
    return CurrentConsent(
        contact_id=overrides.pop("contact_id", uuid4()),
        channel=channel,
        granted=granted,
        source="sms_reply",
        occurred_at=datetime.now(timezone.utc),
        **overrides,
    )
