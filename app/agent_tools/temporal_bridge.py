"""Route a durable tool's side effect through Temporal instead of inline.

A tool marked ``durable=True`` must not mutate contact/outreach state directly
from inside a live turn — that side effect belongs in the durable runtime so it
inherits the decision engine's idempotency, retry, and compliance guarantees
(see AGENTS.md's "deterministic core, generative edge" invariant).

The mechanism mirrors ``activities/logging.py::emit_interaction_result_signal``:
build a ``Signal`` and deliver it to the contact's ``ContactLoopWorkflow`` via
**signal-with-start**, so it is a no-op start when the loop is already running
and a clean start when it is not (e.g. a brand-new contact mid-call). The tool
returns immediately with an acknowledgement; the decision engine picks the
signal up on the next loop tick and decides what, if anything, to emit.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.agent_tools.context import ToolContext
from app.core.config import settings
from app.core.logging import logger
from app.schemas.signals import Signal
from app.services.clients.supabase_client import execute_query, get_service_role_client
from app.services.clients.temporal_client import get_temporal_client


async def emit_tool_signal(
    context: ToolContext,
    *,
    signal_type: str,
    payload: dict[str, Any],
    source: str = "agent_tool",
) -> str:
    """Persist a ``signals`` row and deliver it to the contact's workflow.

    Args:
        context: The invocation context carrying ``org_id``/``contact_id``.
        signal_type: The ``signals.type`` value — must be a valid
            ``app.schemas.signals.SignalType`` literal (e.g. ``"manual"`` for an
            agent-initiated event). Carry the specific tool intent in ``payload``.
        payload: JSON payload stored on the signal and read by the engine.
        source: ``signals.source`` label; defaults to ``"agent_tool"``.

    Returns:
        The new signal id.
    """
    client = await get_service_role_client()
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "org_id": context.org_id,
        "contact_id": context.contact_id,
        "type": signal_type,
        "source": source,
        "payload": payload,
        "received_at": now,
        "delivered_at": now,
    }
    response = await execute_query(client.table("signals").insert(row))
    signal = Signal(**response.data[0])

    # Local import: mirror activities/logging.py — the workflow module pulls in
    # the Temporal sandbox, so keep it out of the module top level.
    from workflows.contact_loop import ContactLoopWorkflow
    from workflows.models import ContactLoopInput, SignalEnvelope

    temporal_client = await get_temporal_client()
    await temporal_client.start_workflow(
        ContactLoopWorkflow.run,
        ContactLoopInput(contact_id=context.contact_id, org_id=context.org_id),
        id=f"contact-loop:{context.contact_id}",
        task_queue=settings.TEMPORAL_TASK_QUEUE,
        start_signal="signal_received",
        start_signal_args=[SignalEnvelope(signal=signal, channel=context.channel)],
    )
    logger.info(
        "agent_tool_signal_emitted",
        contact_id=context.contact_id,
        signal_type=signal_type,
        signal_id=str(signal.id),
    )
    return str(signal.id)


def temporal_available() -> Optional[str]:
    """Return the configured Temporal address, or ``None`` if unconfigured.

    Lets a durable tool degrade to a plain acknowledgement (rather than crash a
    live turn) when Temporal is not wired up, e.g. in a playground session.
    """
    return getattr(settings, "TEMPORAL_ADDRESS", None)
