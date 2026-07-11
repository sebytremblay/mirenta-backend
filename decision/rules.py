"""Rule handlers per `Signal.type` — the decision-engine state machine.

Only `inbound_sms` and `interaction_result` are handled this pass; voice
rules are future work (see `decision/engine.py`'s `SIGNAL_HANDLERS`).
"""

from datetime import datetime

from app.schemas.contacts import Contact, ContactState, CurrentConsent
from app.schemas.signals import Signal
from decision.guardrails import next_allowed_send_time, run_hard_guardrails
from decision.idempotency import derive_idempotency_key
from decision.models import DecisionOutput, ProposedTask


def decide_on_inbound_sms(
    *,
    signal: Signal,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    now: datetime,
) -> DecisionOutput:
    """Inbound SMS -> reply task, gated by the hard guardrails and deferred past quiet hours."""
    denials = run_hard_guardrails(
        contact=contact, contact_state=contact_state, consent=consent, channel="sms", now=now
    )
    if denials:
        return DecisionOutput(tasks=[], contact_state_patch={}, guardrail_denials=denials)

    task = ProposedTask(
        type="sms",
        idempotency_key=derive_idempotency_key(signal.id, "sms", sequence=0),
        scheduled_for=next_allowed_send_time(contact, now),
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
    }
    return DecisionOutput(tasks=[task], contact_state_patch=patch, guardrail_denials=[])


def decide_on_interaction_result(
    *,
    signal: Signal,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    now: datetime,
) -> DecisionOutput:
    """Closes the loop: folds a logged interaction's outcome back into contact_state.

    Emits no new tasks this pass — no auto-follow-up rules yet.
    """
    outcome = signal.payload.get("outcome")
    patch: dict = {"last_contacted_at": now}
    summary = signal.payload.get("summary")
    if summary:
        patch["memory_summary"] = summary
    if outcome == "opt_out":
        patch["current_state"] = "opted_out"
    elif outcome == "goal_achieved":
        patch["current_state"] = "goal_achieved"
    else:
        patch["current_state"] = "active"
    return DecisionOutput(tasks=[], contact_state_patch=patch, guardrail_denials=[])
