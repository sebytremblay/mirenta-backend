"""Rule handlers per `Signal.type` — the decision-engine state machine.

`inbound_sms`, `interaction_result`, and `meeting_scheduled` are handled;
other voice rules are future work (see `decision/engine.py`'s `SIGNAL_HANDLERS`).
"""

from datetime import datetime, timedelta

from app.schemas.contacts import Contact, ContactState, CurrentConsent
from app.schemas.signals import Signal
from decision.guardrails import next_allowed_send_time, run_hard_guardrails
from decision.idempotency import derive_idempotency_key
from decision.models import DecisionOutput, ProposedTask

FOLLOW_UP_DELAY = timedelta(days=3)
FOLLOW_UP_GOAL = "follow_up_no_response"
POST_MEETING_GOAL = "post_meeting_followup"
# current_state set once a meeting is on the books; read by
# decide_on_interaction_result to suppress the generic silence follow-up.
MEETING_SCHEDULED_STATE = "meeting_scheduled"
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


def decide_on_meeting_scheduled(
    *,
    signal: Signal,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    now: datetime,
) -> DecisionOutput:
    """Meeting booked -> schedule one post-meeting follow-up email at meeting-end.

    Fired when the voice agent books a tour (`app/api/routers/voice.py`). Emits
    one `email` task (`goal=post_meeting_followup`) scheduled for the meeting's
    end time, gated by the hard guardrails on the `email` channel. The durable
    Temporal timer in `TaskExecutionWorkflow` sleeps until that time and sends
    the follow-up from the org's connected Google account. Sets `current_state`
    so a later voice `interaction_result` does not also schedule the generic
    silence nudge.

    The meeting end time comes from the signal payload (`meeting_end`, ISO 8601).
    A missing/invalid time emits no task rather than guessing a send time. Quiet
    hours does not apply: an email fires at the meeting's end regardless of the
    local hour, since it is not an intrusive channel the way an SMS is.

    The customer's `recipient_email` (captured on the call) rides through the
    signal payload onto the task so the send activity mails the caller, never
    the contact row — the contact is the realtor/org, not the person who called.
    """
    meeting_end_raw = signal.payload.get("meeting_end")
    if not meeting_end_raw:
        return DecisionOutput(tasks=[], contact_state_patch={}, guardrail_denials=[])
    try:
        meeting_end = datetime.fromisoformat(meeting_end_raw)
    except ValueError:
        return DecisionOutput(tasks=[], contact_state_patch={}, guardrail_denials=[])

    patch: dict = {"current_state": MEETING_SCHEDULED_STATE}

    denials = run_hard_guardrails(
        contact=contact, contact_state=contact_state, consent=consent, channel="email", now=now
    )
    if denials:
        return DecisionOutput(tasks=[], contact_state_patch=patch, guardrail_denials=denials)

    scheduled_for = meeting_end
    task = ProposedTask(
        type="email",
        idempotency_key=derive_idempotency_key(signal.id, "email", sequence=0),
        scheduled_for=scheduled_for,
        payload={
            "goal": POST_MEETING_GOAL,
            "trigger_signal_id": str(signal.id),
            "recipient_email": signal.payload.get("recipient_email"),
            "meeting_start": signal.payload.get("meeting_start"),
            "meeting_end": signal.payload.get("meeting_end"),
            "meeting_location": signal.payload.get("meeting_location"),
        },
    )
    patch["next_task_at"] = scheduled_for
    return DecisionOutput(tasks=[task], contact_state_patch=patch, guardrail_denials=[])


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

    tasks: list[ProposedTask] = []

    # A booked meeting owns the next touch (the post-meeting follow-up scheduled
    # by decide_on_meeting_scheduled). Don't overwrite that state or stack a
    # generic silence nudge on top of the thank-you.
    if contact_state.current_state == MEETING_SCHEDULED_STATE:
        return DecisionOutput(tasks=tasks, contact_state_patch=patch, guardrail_denials=[])

    patch["current_state"] = "active"

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
