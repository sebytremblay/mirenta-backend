"""Shared Temporal payload models.

Imported by both `workflows/` (workflow sandbox) and
`activities/logging.py` (to construct a signal envelope when delivering an
`interaction_result` signal back to a contact's workflow).
"""

from pydantic import BaseModel

from app.schemas.signals import Signal


class ContactLoopInput(BaseModel):
    """Arguments to `ContactLoopWorkflow.run`."""

    contact_id: str
    org_id: str


class SignalEnvelope(BaseModel):
    """What `ContactLoopWorkflow.signal_received` carries.

    Enough to run the decision engine without another round trip just to
    look up basic signal metadata.
    """

    signal: Signal
    channel: str  # decision-engine channel context ("sms" for now)


class TaskExecutionInput(BaseModel):
    """Arguments to `TaskExecutionWorkflow.run`."""

    task_id: str
