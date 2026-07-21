"""Unit tests for deterministic phonetic email collapse (the core email fix).

These lock in the behavior that broke on the live call: a spelled address must
collapse to one exact string, so the address read back to the caller and the
address booked can never diverge.
"""

from __future__ import annotations

import pytest

from call_state import CallData, collapse_email


def test_collapse_nato_local_part() -> None:
    # The exact sequence from the failed call: sierra echo bravo yankee bravo
    # alpha sierra -> sebybas. Previously the model emitted "sebbybasa".
    tokens = ["sierra", "echo", "bravo", "yankee", "bravo", "alpha", "sierra"]
    assert collapse_email(tokens, "gmail.com") == "sebybas@gmail.com"


def test_collapse_spoken_domain() -> None:
    tokens = ["sierra", "echo", "bravo"]
    assert collapse_email(tokens, "gmail dot com") == "seb@gmail.com"


def test_collapse_ignores_separator_words_in_local_part() -> None:
    tokens = ["sierra", "echo", "bravo", "at", "dot"]
    assert collapse_email(tokens, "gmail.com") == "seb@gmail.com"


def test_collapse_accepts_bare_letters_and_digits() -> None:
    tokens = ["s", "e", "b", "seven"]
    assert collapse_email(tokens, "gmail.com") == "seb7@gmail.com"


def test_collapse_is_case_insensitive() -> None:
    tokens = ["Sierra", "ECHO", "Bravo"]
    assert collapse_email(tokens, "GMAIL.COM") == "seb@gmail.com"


def test_collapse_handles_juliett_and_xray_variants() -> None:
    assert collapse_email(["juliett", "x-ray", "xray"], "gmail.com") == "jxx@gmail.com"


def test_collapse_empty_local_part_raises() -> None:
    with pytest.raises(ValueError):
        collapse_email([], "gmail.com")


def test_collapse_empty_domain_raises() -> None:
    with pytest.raises(ValueError):
        collapse_email(["sierra"], "")


def test_call_data_defaults() -> None:
    data = CallData()
    assert data.email is None
    assert data.booked_event_id is None
    assert data.guardrail_flags == []
