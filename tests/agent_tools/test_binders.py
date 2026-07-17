"""Unit tests for the LangChain binder and context injection."""

import asyncio

from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from app.agent_tools.binders import build_langchain_tools, to_langchain_tool
from app.agent_tools.context import ToolContext
from app.agent_tools.registry import AgentTool


class _EchoArgs(BaseModel):
    value: str


def _echo_tool() -> AgentTool:
    async def _fn(context: ToolContext, args: _EchoArgs) -> str:
        # Prove the context is injected by the binder, not the model.
        return f"{context.org_id}:{context.contact_id}:{args.value}"

    return AgentTool(name="echo", description="echo the value", args_model=_EchoArgs, fn=_fn)


def _context() -> ToolContext:
    return ToolContext(org_id="org-9", contact_id="contact-9", channel="sms")


def test_to_langchain_tool_builds_structured_tool_with_schema() -> None:
    tool = to_langchain_tool(_echo_tool(), _context())
    assert isinstance(tool, StructuredTool)
    assert tool.name == "echo"
    assert tool.description == "echo the value"
    # Schema is derived from the shared Pydantic args model.
    assert tool.args_schema is _EchoArgs


def test_langchain_tool_injects_context_and_runs() -> None:
    tool = to_langchain_tool(_echo_tool(), _context())
    result = asyncio.run(tool.ainvoke({"value": "hi"}))
    # Model supplied only ``value``; org/contact came from the bound context.
    assert result == "org-9:contact-9:hi"


def test_build_langchain_tools_binds_all() -> None:
    tools = build_langchain_tools([_echo_tool(), _echo_tool()], _context())
    assert len(tools) == 2
    assert all(isinstance(t, StructuredTool) for t in tools)
