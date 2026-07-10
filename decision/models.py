"""Shared decision-engine models.

Split out from `engine.py` so `rules.py` can depend on them without
`engine.py` and `rules.py` importing each other.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.tasks import TaskType
from decision.guardrails import GuardrailDenial


class ProposedTask(BaseModel):
    """A task the engine wants emitted — not yet a DB row (no id/org_id/created_at)."""

    type: TaskType
    idempotency_key: str
    scheduled_for: datetime
    payload: dict[str, Any] = Field(default_factory=dict)


class DecisionOutput(BaseModel):
    """What the decision engine produces for one (signal, contact_state) pair."""

    tasks: list[ProposedTask] = Field(default_factory=list)
    contact_state_patch: dict[str, Any] = Field(default_factory=dict)
    guardrail_denials: list[GuardrailDenial] = Field(default_factory=list)
