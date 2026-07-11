"""Unit tests for app/core/langgraph/nodes/voice_output_guardrails.py's `_check_draft`.

Pure function -- no LangGraph runtime or LLM call needed. Mirrors
`test_output_guardrails.py`, but voice has no STOP-keyword requirement
(SMS/TCPA-specific, no voice equivalent).
"""

from app.core.langgraph.nodes.voice_output_guardrails import _check_draft

COMPLIANT_DRAFT = "See you at 3pm Tuesday, we'll see you then."


def test_check_draft_passes_clean_draft_without_stop_language() -> None:
    assert _check_draft(COMPLIANT_DRAFT, {}) == []


def test_check_draft_flags_length_violation() -> None:
    long_draft = "See you at 3pm Tuesday. " + ("filler " * 100)
    violations = _check_draft(long_draft, {"max_length": 600})
    assert any("max length" in violation for violation in violations)


def test_check_draft_flags_pii_ssn_pattern() -> None:
    draft = "Your SSN 123-45-6789 is on file."
    violations = _check_draft(draft, {})
    assert any("ssn" in violation for violation in violations)


def test_check_draft_flags_prohibited_claim() -> None:
    draft = "This is a guaranteed cure!"
    violations = _check_draft(draft, {})
    assert any("prohibited claim" in violation for violation in violations)
