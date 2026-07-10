"""Unit tests for decision/idempotency.py."""

from uuid import uuid4

from decision.idempotency import derive_idempotency_key


def test_derive_idempotency_key_is_deterministic() -> None:
    signal_id = uuid4()
    first = derive_idempotency_key(signal_id, "sms", sequence=0)
    second = derive_idempotency_key(signal_id, "sms", sequence=0)
    assert first == second


def test_derive_idempotency_key_differs_by_sequence() -> None:
    signal_id = uuid4()
    first = derive_idempotency_key(signal_id, "sms", sequence=0)
    second = derive_idempotency_key(signal_id, "sms", sequence=1)
    assert first != second


def test_derive_idempotency_key_differs_by_signal_id() -> None:
    first = derive_idempotency_key(uuid4(), "sms", sequence=0)
    second = derive_idempotency_key(uuid4(), "sms", sequence=0)
    assert first != second


def test_derive_idempotency_key_is_prefixed_with_task_type() -> None:
    key = derive_idempotency_key(uuid4(), "sms", sequence=0)
    assert key.startswith("sms:")
