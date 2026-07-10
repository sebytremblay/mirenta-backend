"""Deterministic idempotency-key derivation for `tasks.idempotency_key`."""

import hashlib
from uuid import UUID


def derive_idempotency_key(signal_id: UUID, task_type: str, sequence: int = 0) -> str:
    """Deterministic from (signal_id, task_type, sequence) — never random/wall-clock.

    `sequence` disambiguates multiple same-type tasks emitted from one
    signal (not needed for the inbound_sms rule today, but keeps the
    derivation stable if a future rule emits more than one same-type task
    from a single signal).
    """
    digest = hashlib.sha256(f"{signal_id}:{task_type}:{sequence}".encode()).hexdigest()
    return f"{task_type}:{digest[:32]}"
