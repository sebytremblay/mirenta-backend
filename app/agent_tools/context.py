"""Per-invocation context handed to every agent tool.

The one piece of shared-tool design that actually bites is context injection:
a channel-neutral tool function cannot reach into LangGraph's ``RunnableConfig``
or LiveKit's session/room userdata for the ids it needs (``org_id``,
``contact_id``, the call/thread correlation). So we make it explicit — each
binder populates a ``ToolContext`` from its own framework's ambient state at
bind time, and every registered tool receives it as its first argument.

Keep this dataclass framework-neutral: no LangChain, LangGraph, or LiveKit
imports. That neutrality is what lets one tool body run behind both binders.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass(frozen=True)
class ToolContext:
    """Correlation ids + carrier for a single tool invocation.

    Populated by a binder (never by the tool author) from the ambient state
    of whichever runtime is driving the turn. ``org_id`` and ``contact_id``
    are the always-present Mirenta correlation ids; the rest are channel- or
    call-specific and may be ``None`` in a playground/console session.
    """

    org_id: str
    contact_id: str
    channel: str  # "sms" | "voice" | "email" | "website" | "console"
    thread_id: Optional[str] = None  # LangGraph checkpoint thread (text channels)
    call_sid: Optional[str] = None  # Twilio call correlation (voice)
    signal_id: Optional[str] = None  # signal that opened this turn, when known
    user_id: Optional[str] = None  # dashboard user, when a human is in the loop
    extra: dict[str, Any] = field(default_factory=dict)  # binder-specific extras
