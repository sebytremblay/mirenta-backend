"""output_guardrails node — deterministic checkpoint before anything is sent.

Runs after `compose` but before anything is sent. No LLM call here
(deterministic checks only, for now) — the routing decision below
(pass/retry/escalate) is the seam a future LLM classifier could slot into
without restructuring the graph.
"""

import re

from langchain_core.messages import AIMessage
from langgraph.graph import END
from langgraph.graph.state import Command

from app.core.langgraph.state import SMSState
from app.core.logging import logger

MAX_GUARDRAIL_ATTEMPTS = 3
SMS_MAX_LENGTH = 320  # ~2 segments (160 chars/segment, GSM-7)
OPT_OUT_PATTERN = re.compile(r"\bstop\b", re.IGNORECASE)
PROHIBITED_CLAIM_KEYWORDS = ("guaranteed cure", "100% effective", "no side effects")
PII_PATTERNS = {
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
}


def _check_draft(draft: str, channel_constraints: dict) -> list[str]:
    """Return a list of violation strings; empty means the draft passed."""
    violations: list[str] = []
    max_length = channel_constraints.get("max_length", SMS_MAX_LENGTH)
    if len(draft) > max_length:
        violations.append(f"draft exceeds max length ({len(draft)} > {max_length})")
    if not OPT_OUT_PATTERN.search(draft):
        violations.append("missing opt-out language (must mention 'STOP')")
    lowered = draft.lower()
    for phrase in PROHIBITED_CLAIM_KEYWORDS:
        if phrase in lowered:
            violations.append(f"prohibited claim: '{phrase}'")
    for kind, pattern in PII_PATTERNS.items():
        if pattern.search(draft):
            violations.append(f"possible {kind} detected")
    return violations


async def output_guardrails(state: SMSState) -> Command:
    """Validate the drafted message: pass -> send, fail -> retry or escalate."""
    violations = _check_draft(state.draft or "", state.channel_constraints)
    attempts = state.guardrail_attempts + 1

    if not violations:
        logger.info("sms_guardrails_passed", guardrail_attempts=attempts)
        return Command(
            update={
                "messages": [AIMessage(content=state.draft or "")],
                "guardrail_attempts": attempts,
                "guardrail_feedback": None,
            },
            goto=END,
        )

    if attempts >= MAX_GUARDRAIL_ATTEMPTS:
        logger.warning("sms_guardrails_escalated", guardrail_attempts=attempts, violations=violations)
        fallback = "Sorry, I'm having trouble responding right now — a team member will follow up shortly."
        return Command(
            update={
                "messages": [
                    AIMessage(
                        content=fallback,
                        additional_kwargs={"guardrail_escalated": True, "violations": violations},
                    )
                ],
                "guardrail_attempts": attempts,
            },
            goto=END,
        )

    logger.info("sms_guardrails_failed_retrying", guardrail_attempts=attempts, violations=violations)
    return Command(
        update={"guardrail_attempts": attempts, "guardrail_feedback": "; ".join(violations)},
        goto="compose",
    )
