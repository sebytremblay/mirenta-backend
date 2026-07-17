"""Channel-neutral agent tools shared across every runtime.

One tool definition binds into both agent runtimes:

- the request/response text runtime (``BaseChannelAgent`` — SMS/email/website)
  via :func:`to_langchain_tool`, and
- the streaming voice runtime (``livekit_agent/``) via
  :func:`to_livekit_function_tool`.

Tool bodies are plain async functions wrapping ``app/services`` domain logic;
the binders derive each SDK's schema from a shared Pydantic args model, so there
is no per-tool, per-SDK duplication. Correlation ids ride in :class:`ToolContext`,
populated by each binder from its runtime's ambient state.

See this package's ``CLAUDE.md`` for the design, the Temporal durable-effect
pattern, and how to add a real tool.
"""

from app.agent_tools.binders import (
    build_langchain_tools,
    to_langchain_tool,
    to_livekit_function_tool,
)
from app.agent_tools.context import ToolContext
from app.agent_tools.registry import AgentTool, get_tool, get_tools, register

# Import example tools for their registration side effects so ``get_tools`` can
# find them. Remove this import once real tools replace the examples.
from app.agent_tools import examples as _examples  # noqa: F401

__all__ = [
    "AgentTool",
    "ToolContext",
    "register",
    "get_tool",
    "get_tools",
    "to_langchain_tool",
    "to_livekit_function_tool",
    "build_langchain_tools",
]
