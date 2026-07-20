"""Unit tests for decision/rules.py and decision/engine.py."""

from datetime import datetime, timedelta, timezone

from decision.engine import evaluate
from decision.rules import (
    POST_MEETING_GOAL,
    decide_on_inbound_sms,
    decide_on_interaction_result,
    decide_on_meeting_scheduled,
)
from tests.decision.factories import make_contact, make_contact_state, make_signal


def test_decide_on_inbound_sms_emits_sms_task_when_clean() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(type="inbound_sms", contact_id=contact.id, org_id=contact.org_id, payload={"body": "hi"})

    output = decide_on_inbound_sms(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert len(output.tasks) == 1
    task = output.tasks[0]
    assert task.type == "sms"
    assert task.scheduled_for == now
    assert task.payload["goal"] == "reply_to_inbound_sms"
    assert task.payload["trigger_signal_id"] == str(signal.id)
    assert output.contact_state_patch["contact_attempts"] == 1
    assert output.guardrail_denials == []


def test_decide_on_inbound_sms_schedules_immediately_during_quiet_hours() -> None:
    # 1am UTC — inside the 9pm-8am quiet-hours window for a UTC contact.
    now = datetime(2026, 7, 11, 1, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(type="inbound_sms", contact_id=contact.id, org_id=contact.org_id, payload={"body": "hi"})

    output = decide_on_inbound_sms(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert len(output.tasks) == 1
    assert output.tasks[0].scheduled_for == now


def test_decide_on_inbound_sms_blocked_by_dnc_emits_no_task() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="dnc", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(type="inbound_sms", contact_id=contact.id, org_id=contact.org_id)

    output = decide_on_inbound_sms(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert output.tasks == []
    assert output.contact_state_patch == {}
    assert any(denial.check == "dnc" for denial in output.guardrail_denials)


def test_decide_on_interaction_result_sets_opted_out_state() -> None:
    now = datetime.now(timezone.utc)
    contact = make_contact()
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="interaction_result", contact_id=contact.id, org_id=contact.org_id, payload={"outcome": "opt_out"}
    )

    output = decide_on_interaction_result(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert output.tasks == []
    assert output.contact_state_patch["current_state"] == "opted_out"


def test_decide_on_interaction_result_schedules_three_day_follow_up() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="interaction_result",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={"outcome": "progressed", "task_goal": "reply_to_inbound_sms"},
    )

    output = decide_on_interaction_result(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert len(output.tasks) == 1
    task = output.tasks[0]
    assert task.payload["goal"] == "follow_up_no_response"
    assert task.scheduled_for == now + timedelta(days=3)
    assert output.contact_state_patch["current_state"] == "active"
    assert output.contact_state_patch["next_task_at"] == task.scheduled_for


def test_decide_on_interaction_result_skips_follow_up_after_follow_up() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="interaction_result",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={"outcome": "progressed", "task_goal": "follow_up_no_response"},
    )

    output = decide_on_interaction_result(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert output.tasks == []


def test_decide_on_inbound_sms_requests_follow_up_cancel() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(type="inbound_sms", contact_id=contact.id, org_id=contact.org_id, payload={"body": "hi"})

    output = decide_on_inbound_sms(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert output.cancel_scheduled_follow_ups is True


def test_decide_on_meeting_scheduled_emits_email_followup_at_meeting_end() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    meeting_end = datetime(2026, 7, 12, 15, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="meeting_scheduled",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={
            "meeting_start": "2026-07-12T14:00:00+00:00",
            "meeting_end": meeting_end.isoformat(),
            "meeting_location": "123 Main St",
        },
    )

    output = decide_on_meeting_scheduled(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert len(output.tasks) == 1
    task = output.tasks[0]
    assert task.type == "email"
    assert task.payload["goal"] == POST_MEETING_GOAL
    assert task.payload["meeting_location"] == "123 Main St"
    assert task.payload["meeting_start"] == "2026-07-12T14:00:00+00:00"
    # Scheduled for the meeting's end time exactly (no quiet-hours deferral).
    assert task.scheduled_for == meeting_end
    assert output.contact_state_patch["current_state"] == "meeting_scheduled"
    assert output.contact_state_patch["next_task_at"] == task.scheduled_for
    assert output.guardrail_denials == []


def test_decide_on_meeting_scheduled_missing_end_emits_no_task() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="meeting_scheduled",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={"meeting_start": "2026-07-12T14:00:00+00:00"},
    )

    output = decide_on_meeting_scheduled(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert output.tasks == []
    assert output.contact_state_patch == {}


def test_decide_on_meeting_scheduled_blocked_by_dnc_still_sets_state() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="dnc", timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="meeting_scheduled",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={"meeting_end": "2026-07-12T15:00:00+00:00"},
    )

    output = decide_on_meeting_scheduled(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert output.tasks == []
    assert output.contact_state_patch["current_state"] == "meeting_scheduled"
    assert any(denial.check == "dnc" for denial in output.guardrail_denials)


def test_decide_on_interaction_result_suppresses_followup_after_meeting_scheduled() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(status="active", timezone_name="UTC")
    contact_state = make_contact_state(
        contact_id=contact.id, org_id=contact.org_id, current_state="meeting_scheduled"
    )
    signal = make_signal(
        type="interaction_result",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={"outcome": "progressed", "task_goal": "reply_to_inbound_sms"},
    )

    output = decide_on_interaction_result(
        signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now
    )

    assert output.tasks == []
    assert "current_state" not in output.contact_state_patch


def test_evaluate_dispatches_meeting_scheduled_to_rules_handler() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(
        type="meeting_scheduled",
        contact_id=contact.id,
        org_id=contact.org_id,
        payload={"meeting_end": "2026-07-12T15:00:00+00:00"},
    )

    output = evaluate(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert len(output.tasks) == 1


def test_evaluate_dispatches_inbound_sms_to_rules_handler() -> None:
    now = datetime(2026, 7, 10, 14, 0, tzinfo=timezone.utc)
    contact = make_contact(timezone_name="UTC")
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(type="inbound_sms", contact_id=contact.id, org_id=contact.org_id, payload={"body": "hi"})

    output = evaluate(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert len(output.tasks) == 1


def test_evaluate_unknown_signal_type_returns_empty_output() -> None:
    now = datetime.now(timezone.utc)
    contact = make_contact()
    contact_state = make_contact_state(contact_id=contact.id, org_id=contact.org_id)
    signal = make_signal(type="webhook", contact_id=contact.id, org_id=contact.org_id)

    output = evaluate(signal=signal, contact=contact, contact_state=contact_state, consent=None, now=now)

    assert output.tasks == []
    assert output.contact_state_patch == {}
    assert output.guardrail_denials == []
