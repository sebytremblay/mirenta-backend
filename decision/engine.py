"""(signal, contact_state, ...) -> DecisionOutput.

Zero LLM calls, zero `app.core.langgraph` imports — see AGENTS.md's
deterministic-core invariant. `now` is always passed in by the caller
(never `datetime.now()` inside this package) so the engine is both
unit-testable without a clock and safe to call directly from Temporal
workflow code (which must use `workflow.now()`, not wall-clock reads, for
replay-determinism).
"""

from datetime import datetime
from collections.abc import Callable

from app.schemas.contacts import Contact, ContactState, CurrentConsent
from app.schemas.signals import Signal, SignalType
from decision import rules
from decision.models import DecisionOutput, ProposedTask

__all__ = ["ProposedTask", "DecisionOutput", "evaluate"]

RuleHandler = Callable[..., DecisionOutput]

SIGNAL_HANDLERS: dict[SignalType, RuleHandler] = {
    "inbound_sms": rules.decide_on_inbound_sms,
    "interaction_result": rules.decide_on_interaction_result,
}


def evaluate(
    *,
    signal: Signal,
    contact: Contact,
    contact_state: ContactState,
    consent: CurrentConsent | None,
    now: datetime,
) -> DecisionOutput:
    """Given (signal, contact_state) emit the same tasks every time — pure function.

    Unhandled signal types (voice rules, future work) are a no-op:
    an empty `DecisionOutput`.
    """
    handler = SIGNAL_HANDLERS.get(signal.type)
    if handler is None:
        return DecisionOutput()
    return handler(signal=signal, contact=contact, contact_state=contact_state, consent=consent, now=now)
