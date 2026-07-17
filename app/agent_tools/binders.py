"""Mechanically derive per-SDK tool wrappers from a registered ``AgentTool``.

Each binder is written once and works for every tool: it reads the shared
``args_model`` for the JSON schema, closes over a :class:`ToolContext` supplied
at bind time, and delegates execution to ``AgentTool.run``. Adding a tool never
touches this file.

- :func:`to_langchain_tool` — for the request/response text runtime
  (``BaseChannelAgent`` on SMS / email / website). Returns a
  ``StructuredTool`` ready for ``LLMService.bind_tools``.
- :func:`to_livekit_function_tool` — for the streaming voice runtime
  (``livekit_agent/``). ``livekit.agents`` is **not** a dependency of the main
  app (that project has its own ``pyproject.toml``), so the import is lazy and
  local — importing this module never requires the LiveKit SDK to be installed.
"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import StructuredTool

from app.agent_tools.context import ToolContext
from app.agent_tools.registry import AgentTool


def to_langchain_tool(tool: AgentTool, context: ToolContext) -> StructuredTool:
    """Wrap an ``AgentTool`` as a LangChain ``StructuredTool``.

    The ``context`` is captured in the closure so the LLM only ever supplies
    the ``args_model`` fields — correlation ids are never model-visible.
    """

    async def _run(**kwargs: Any) -> str:
        args = tool.args_model(**kwargs)
        return await tool.run(context, args)

    return StructuredTool.from_function(
        coroutine=_run,
        name=tool.name,
        description=tool.description,
        args_schema=tool.args_model,
    )


def to_livekit_function_tool(tool: AgentTool, context: ToolContext) -> Any:
    """Wrap an ``AgentTool`` as a LiveKit Agents ``function_tool``.

    Imports ``livekit.agents`` lazily so the main FastAPI/Temporal app — which
    does not install the LiveKit Agents SDK — can import this module freely.
    Call this only from inside ``livekit_agent/`` (or a process that has the
    SDK), typically to build the ``tools=[...]`` list on the ``Agent``.

    Raises:
        RuntimeError: If ``livekit.agents`` is not importable in this process.
    """
    try:
        from livekit.agents import RunContext, function_tool  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - depends on deploy target
        raise RuntimeError(
            "to_livekit_function_tool requires the 'livekit-agents' package, which is only "
            "installed in the livekit_agent/ project. Call this from the voice worker."
        ) from exc

    # A raw-schema tool: LiveKit passes the LLM's arguments as a dict and injects
    # its own RunContext. Name/description come from ``raw_schema`` (the
    # ``name``/``description`` kwargs are ignored on the raw path), so we build
    # the whole schema from the shared args model.
    async def _run(raw_arguments: dict[str, Any], ctx: RunContext) -> str:
        args = tool.args_model(**raw_arguments)
        return await tool.run(context, args)

    return function_tool(_run, raw_schema=_raw_schema(tool))


def _raw_schema(tool: AgentTool) -> dict[str, Any]:
    """Build the OpenAI-style function schema LiveKit expects from the args model."""
    return {
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.args_model.model_json_schema(),
    }


def build_langchain_tools(
    tools: list[AgentTool],
    context: ToolContext,
) -> list[StructuredTool]:
    """Bind a list of registered tools for the LangChain text runtime."""
    return [to_langchain_tool(t, context) for t in tools]


# Note: no eager ``build_livekit_tools`` helper here — that batch binding lives
# in the voice worker (``livekit_agent/``) where the SDK is installed, so this
# module stays importable without ``livekit-agents``.
