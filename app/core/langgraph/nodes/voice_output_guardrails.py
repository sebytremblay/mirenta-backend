"""voice_output_guardrails node — deterministic checkpoint before a turn is spoken.

Mirrors `output_guardrails.py`'s pass/retry/escalate shape, but with
voice-appropriate checks: a looser spoken-length cap and, deliberately, no
STOP-keyword requirement -- that's an SMS/TCPA convention with no voice
equivalent. Handling a caller saying "stop calling me" is a business-logic
classification problem, not an output guardrail, and is out of scope for
this pass (see `docs/architecture.md`'s known gaps).
"""

from langchain_core.messages import AIMessage
from langgraph.graph import END
from langgraph.graph.state import Command

from app.core.langgraph.nodes._shared_checks import check_pii, check_prohibited_claims
from app.core.langgraph.state import VoiceState
from app.core.logging import logger

MAX_GUARDRAIL_ATTEMPTS = 3
VOICE_MAX_LENGTH = 600


def _check_draft(draft: str, channel_constraints: dict) -> list[str]:
    """Return a list of violation strings; empty means the draft passed."""
    violations: list[str] = []
    max_length = channel_constraints.get("max_length", VOICE_MAX_LENGTH)
    if len(draft) > max_length:
        violations.append(f"draft exceeds max length ({len(draft)} > {max_length})")
    violations.extend(check_prohibited_claims(draft.lower()))
    violations.extend(check_pii(draft))
    return violations


async def output_guardrails(state: VoiceState) -> Command:
    """Validate the drafted turn: pass -> speak, fail -> retry or escalate."""
    violations = _check_draft(state.draft or "", state.channel_constraints)
    attempts = state.guardrail_attempts + 1

    if not violations:
        logger.info("voice_guardrails_passed", guardrail_attempts=attempts)
        return Command(
            update={
                "messages": [AIMessage(content=state.draft or "")],
                "guardrail_attempts": attempts,
                "guardrail_feedback": None,
            },
            goto=END,
        )

    if attempts >= MAX_GUARDRAIL_ATTEMPTS:
        logger.warning("voice_guardrails_escalated", guardrail_attempts=attempts, violations=violations)
        fallback = "Sorry, let me have someone follow up with you."
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

    logger.info("voice_guardrails_failed_retrying", guardrail_attempts=attempts, violations=violations)
    return Command(
        update={"guardrail_attempts": attempts, "guardrail_feedback": "; ".join(violations)},
        goto="compose",
    )
