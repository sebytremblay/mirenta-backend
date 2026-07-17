"""Channel-neutral registry of agent tools.

One definition, many runtimes. A tool is a plain async function that takes a
:class:`ToolContext` first, then a single Pydantic ``args`` model, and returns
a string. The binders in ``binders.py`` mechanically derive the LangChain and
LiveKit wrappers from that signature — authors never write per-SDK glue.

Two axes decide where a tool shows up:

- ``channels`` — which channels may call it (``None`` means all). A binder
  passes its channel and only tools that allow it are bound.
- ``durable`` — whether the tool's side effect must be routed through Temporal
  rather than executed inline. Read-only lookups are ``durable=False`` and run
  in-process; anything that mutates contact/outreach state should be
  ``durable=True`` and hand off to the ``ContactLoopWorkflow`` so the effect
  inherits the runtime's idempotency + retry guarantees (see
  ``docs``/``CLAUDE.md`` in this package for the pattern).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional, Type, TypeVar, cast

from pydantic import BaseModel

from app.agent_tools.context import ToolContext
from app.core.logging import logger

# A tool body: (context, validated args) -> user-facing result string. The args
# parameter is ``Any`` rather than ``BaseModel`` so a body may annotate its own
# concrete args model without tripping parameter contravariance at registration.
ToolFn = Callable[[ToolContext, Any], Awaitable[str]]

# Preserves the concrete decorated-function type through ``register`` so callers
# (and tests) still see a ``Coroutine`` return, not the erased ``ToolFn``.
F = TypeVar("F", bound=Callable[..., Awaitable[str]])


@dataclass(frozen=True)
class AgentTool:
    """Framework-neutral metadata + callable for one registered tool."""

    name: str
    description: str
    args_model: Type[BaseModel]
    fn: ToolFn
    channels: Optional[frozenset[str]] = None  # None => available on all channels
    durable: bool = False  # True => side effect must route through Temporal
    tags: frozenset[str] = frozenset()

    def allows_channel(self, channel: str) -> bool:
        """Whether this tool may be bound for the given channel."""
        return self.channels is None or channel in self.channels

    async def run(self, context: ToolContext, args: BaseModel) -> str:
        """Execute the tool body with structured logging around it."""
        logger.info(
            "agent_tool_invoked",
            tool=self.name,
            channel=context.channel,
            org_id=context.org_id,
            contact_id=context.contact_id,
            durable=self.durable,
        )
        return await self.fn(context, args)


_REGISTRY: dict[str, AgentTool] = {}


def register(
    *,
    name: str,
    description: str,
    args_model: Type[BaseModel],
    channels: Optional[list[str]] = None,
    durable: bool = False,
    tags: Optional[list[str]] = None,
) -> Callable[[F], F]:
    """Register a tool body under ``name`` and return it unchanged.

    Args:
        name: Stable tool name the LLM sees; must be unique in the registry.
        description: Natural-language description used to build both SDK schemas.
        args_model: Pydantic model for the tool's arguments — the single source
            of truth for the JSON schema each binder derives.
        channels: Channels allowed to call this tool; ``None`` means all.
        durable: When ``True``, the body must not perform the side effect inline
            — it routes through Temporal (see package CLAUDE.md).
        tags: Free-form labels (e.g. ``"example"``) for filtering.

    Raises:
        ValueError: If ``name`` is already registered.
    """

    def _decorator(fn: F) -> F:
        if name in _REGISTRY:
            raise ValueError(f"agent tool '{name}' is already registered")
        _REGISTRY[name] = AgentTool(
            name=name,
            description=description,
            args_model=args_model,
            fn=cast(ToolFn, fn),
            channels=frozenset(channels) if channels is not None else None,
            durable=durable,
            tags=frozenset(tags or ()),
        )
        logger.debug("agent_tool_registered", tool=name, channels=channels, durable=durable)
        return fn

    return _decorator


def get_tool(name: str) -> AgentTool:
    """Return a single registered tool by name.

    Raises:
        KeyError: If no tool is registered under ``name``.
    """
    return _REGISTRY[name]


def get_tools(
    *,
    channel: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> list[AgentTool]:
    """Return registered tools filtered by channel applicability and tags.

    Args:
        channel: When set, only tools that allow this channel are returned.
        tags: When set, only tools carrying at least one of these tags.
    """
    wanted_tags = frozenset(tags or ())
    tools = list(_REGISTRY.values())
    if channel is not None:
        tools = [t for t in tools if t.allows_channel(channel)]
    if wanted_tags:
        tools = [t for t in tools if t.tags & wanted_tags]
    return tools
