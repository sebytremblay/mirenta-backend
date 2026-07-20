"""Deterministic content checks shared by every channel's output-guardrails node.

Kept separate from any one channel's guardrail node so SMS and voice check
identical prohibited-claim/PII patterns without drifting — channel-specific
concerns (SMS's length cap + required STOP language, voice's spoken-length
cap) stay in each channel's own guardrail node.
"""

import re

PROHIBITED_CLAIM_KEYWORDS = ("guaranteed cure", "100% effective", "no side effects")
PII_PATTERNS = {
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
}


def check_prohibited_claims(lowered_draft: str) -> list[str]:
    """Return violation strings for any prohibited-claim phrase found in `lowered_draft`."""
    return [f"prohibited claim: '{phrase}'" for phrase in PROHIBITED_CLAIM_KEYWORDS if phrase in lowered_draft]


def check_pii(draft: str) -> list[str]:
    """Return violation strings for any PII pattern (SSN, credit card) found in `draft`."""
    return [f"possible {kind} detected" for kind, pattern in PII_PATTERNS.items() if pattern.search(draft)]
