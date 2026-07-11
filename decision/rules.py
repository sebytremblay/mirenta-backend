"""Rule handlers per `Signal.type` — the decision-engine state machine.

Only `inbound_sms` and `interaction_result` are handled this pass; voice
rules are future work (see `decision/engine.py`'s `SIGNAL_HANDLERS`).
"""

from datetime import datetime, timedelta

from app.schemas.contacts import Contact, ContactState, CurrentConsent
from app.schemas.signals import Signal
from decision.guardrails import next_allowed_send_time, run_hard_guardrails
from decision.idempotency import derive_idempotency_key
from decision.models import DecisionOutput, ProposedTask

FOLLOW_UP_DELAY = timedelta(days=3)
FOLLOW_UP_GOAL = "follow_up_no_response"
# Outcomes that should not schedule a silence follow-up.
TERMINAL_OUTCOMES = frozenset({"opt_out", "goal_achieved", "handoff_human"})


def decide_on_inbound_sms(
    *,
    signal: Signal,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    now: datetime,
) -> DecisionOutput:
    """Inbound SMS -> reply task immediately, gated by the hard guardrails.

    Quiet hours do not apply here: the contact just messaged us, so they're
    awake and expecting a reply. Also cancels any pending no-response
    follow-up — a reply supersedes the scheduled nudge.
    """
    denials = run_hard_guardrails(
        contact=contact, contact_state=contact_state, consent=consent, channel="sms", now=now
    )
    if denials:
        return DecisionOutput(
            tasks=[],
            contact_state_patch={},
            guardrail_denials=denials,
            cancel_scheduled_follow_ups=True,
        )

    task = ProposedTask(
        type="sms",
        idempotency_key=derive_idempotency_key(signal.id, "sms", sequence=0),
        scheduled_for=now,
        payload={
            "goal": "reply_to_inbound_sms",
            "trigger_signal_id": str(signal.id),
            "inbound_body": signal.payload.get("body", ""),
        },
    )
    patch = {
        "contact_attempts": contact_state.contact_attempts + 1,
        "attempts_window_start": contact_state.attempts_window_start or now,
        "current_state": "awaiting_reply_send",
        "next_task_at": None,
    }
    return DecisionOutput(
        tasks=[task],
        contact_state_patch=patch,
        guardrail_denials=[],
        cancel_scheduled_follow_ups=True,
    )


def decide_on_interaction_result(
    *,
    signal: Signal,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    now: datetime,
) -> DecisionOutput:
    """Closes the loop: folds outcome into contact_state; may schedule a 3-day follow-up.

    After a successful outbound SMS that was not itself a follow-up, schedules
    one `follow_up_no_response` SMS for 3 days out (quiet-hours deferred). A
    later inbound SMS cancels that pending task via `cancel_scheduled_follow_ups`.
    """
    outcome = signal.payload.get("outcome")
    source_goal = signal.payload.get("task_goal")
    patch: dict = {"last_contacted_at": now}
    summary = signal.payload.get("summary")
    if summary:
        patch["memory_summary"] = summary
    if outcome == "opt_out":
        patch["current_state"] = "opted_out"
        patch["next_task_at"] = None
        return DecisionOutput(tasks=[], contact_state_patch=patch, guardrail_denials=[])
    if outcome == "goal_achieved":
        patch["current_state"] = "goal_achieved"
        patch["next_task_at"] = None
        return DecisionOutput(tasks=[], contact_state_patch=patch, guardrail_denials=[])

    patch["current_state"] = "active"
    tasks: list[ProposedTask] = []

    should_follow_up = outcome not in TERMINAL_OUTCOMES and source_goal != FOLLOW_UP_GOAL and contact.status != "dnc"
    if should_follow_up:
        denials = run_hard_guardrails(
            contact=contact, contact_state=contact_state, consent=consent, channel="sms", now=now
        )
        if not denials:
            scheduled_for = next_allowed_send_time(contact, now + FOLLOW_UP_DELAY)
            tasks.append(
                ProposedTask(
                    type="sms",
                    idempotency_key=derive_idempotency_key(signal.id, "sms", sequence=0),
                    scheduled_for=scheduled_for,
                    payload={
                        "goal": FOLLOW_UP_GOAL,
                        "trigger_signal_id": str(signal.id),
                    },
                )
            )
            patch["next_task_at"] = scheduled_for
        else:
            return DecisionOutput(tasks=[], contact_state_patch=patch, guardrail_denials=denials)

    return DecisionOutput(tasks=tasks, contact_state_patch=patch, guardrail_denials=[])
