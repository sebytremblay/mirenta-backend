"""Unit tests for app/core/langgraph/nodes/output_guardrails.py's `_check_draft`.

Pure function -- no LangGraph runtime or LLM call needed.
"""

from app.core.langgraph.nodes.output_guardrails import _check_draft

COMPLIANT_DRAFT = "See you at 3pm Tuesday! Reply STOP to opt out."


def test_check_draft_passes_clean_draft() -> None:
    assert _check_draft(COMPLIANT_DRAFT, {}) == []


def test_check_draft_flags_missing_opt_out() -> None:
    violations = _check_draft("See you at 3pm Tuesday!", {})
    assert any("opt-out" in violation for violation in violations)


def test_check_draft_flags_length_violation() -> None:
    long_draft = "See you at 3pm Tuesday! Reply STOP to opt out. " + ("filler " * 60)
    violations = _check_draft(long_draft, {"max_length": 320})
    assert any("max length" in violation for violation in violations)


def test_check_draft_flags_pii_ssn_pattern() -> None:
    draft = "Your SSN 123-45-6789 is on file. Reply STOP to opt out."
    violations = _check_draft(draft, {})
    assert any("ssn" in violation for violation in violations)


def test_check_draft_flags_prohibited_claim() -> None:
    draft = "This is a guaranteed cure! Reply STOP to opt out."
    violations = _check_draft(draft, {})
    assert any("prohibited claim" in violation for violation in violations)
