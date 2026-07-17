"""Unit tests for the SMS compose node's per-turn tool loop.

Covers the two behaviors that matter: with no live tools the node makes exactly
one tool-free llm call (production today), and with a live tool registered the
node runs a bounded tool-call loop and injects context out-of-band.
"""

import asyncio
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig
from pydantic import BaseModel

from app.core.langgraph.nodes import compose as compose_module
from app.core.langgraph.nodes.compose import compose
from app.core.langgraph.state import SMSState


def _config(with_identity: bool = True) -> RunnableConfig:
    metadata = {"task_goal": "reply_to_inbound_sms", "channel_constraints": {"max_length": 320}}
    if with_identity:
        metadata["org_id"] = "org-1"
        metadata["contact_id"] = "contact-1"
    return {"metadata": metadata, "configurable": {"thread_id": "sms:org-1:contact-1"}}


def test_no_live_tools_makes_single_tool_free_call() -> None:
    state = SMSState(messages=[HumanMessage(content="Hi")])
    calls: list = []

    async def _fake_call(messages, model_name=None, response_format=None, tools=None, **kwargs):
        calls.append(tools)
        return AIMessage(content="Hello there.")

    async def _run():
        with patch("app.core.langgraph.nodes.compose._live_sms_tools", return_value=[]), patch(
            "app.core.langgraph.nodes.compose.llm_service.call", new=AsyncMock(side_effect=_fake_call)
        ):
            return await compose(state, _config())

    command = asyncio.run(_run())

    # Exactly one call, and it was tool-free (tools kwarg is None/absent).
    assert len(calls) == 1
    assert not calls[0]
    assert command.update is not None
    assert command.update["draft"] == "Hello there."


def test_no_identity_skips_tools_even_if_registered() -> None:
    """A console-style run without org/contact ids gets no tools."""
    state = SMSState(messages=[HumanMessage(content="Hi")])
    seen_tools: list = []

    async def _fake_call(messages, model_name=None, response_format=None, tools=None, **kwargs):
        seen_tools.append(tools)
        return AIMessage(content="Hello.")

    async def _run():
        # Even if a live tool is registered, missing identity => no context => no tools.
        with patch("app.core.langgraph.nodes.compose._live_sms_tools", return_value=[object()]), patch(
            "app.core.langgraph.nodes.compose.llm_service.call", new=AsyncMock(side_effect=_fake_call)
        ):
            return await compose(state, _config(with_identity=False))

    asyncio.run(_run())
    assert seen_tools == [None]


def test_tool_loop_resolves_calls_then_composes() -> None:
    """With a live tool, a tool_call turn is executed and fed back before the draft."""
    state = SMSState(messages=[HumanMessage(content="What are your hours?")])

    class _Args(BaseModel):
        topic: str

    async def _fake_fn(context, args):
        # Prove context injection: ids come from config metadata, not the model.
        assert context.org_id == "org-1"
        assert context.contact_id == "contact-1"
        return "Open 9 to 5."

    from app.agent_tools.registry import AgentTool

    fake_tool = AgentTool(
        name="lookup_hours",
        description="look up hours",
        args_model=_Args,
        fn=_fake_fn,  # type: ignore[arg-type]
    )

    # First llm response asks for the tool; second returns the final draft.
    responses = [
        AIMessage(
            content="",
            tool_calls=[{"name": "lookup_hours", "args": {"topic": "hours"}, "id": "call-1"}],
        ),
        AIMessage(content="We are open 9 to 5, Monday to Friday."),
    ]

    async def _fake_call(messages, model_name=None, response_format=None, tools=None, **kwargs):
        return responses.pop(0)

    async def _run():
        with patch("app.core.langgraph.nodes.compose._live_sms_tools", return_value=[fake_tool]), patch(
            "app.core.langgraph.nodes.compose.llm_service.call", new=AsyncMock(side_effect=_fake_call)
        ):
            return await compose(state, _config())

    command = asyncio.run(_run())
    assert command.update is not None
    assert command.update["draft"] == "We are open 9 to 5, Monday to Friday."
    assert responses == []  # both llm turns consumed


def test_tool_loop_is_bounded() -> None:
    """A model that always requests a tool is cut off at MAX_TOOL_ITERATIONS."""
    state = SMSState(messages=[HumanMessage(content="loop")])

    class _Args(BaseModel):
        pass

    async def _fake_fn(context, args):
        return "ok"

    from app.agent_tools.registry import AgentTool

    fake_tool = AgentTool(name="always", description="d", args_model=_Args, fn=_fake_fn)  # type: ignore[arg-type]

    call_count = 0

    async def _fake_call(messages, model_name=None, response_format=None, tools=None, **kwargs):
        nonlocal call_count
        call_count += 1
        # Never stops asking for the tool.
        return AIMessage(content="", tool_calls=[{"name": "always", "args": {}, "id": f"c{call_count}"}])

    async def _run():
        with patch("app.core.langgraph.nodes.compose._live_sms_tools", return_value=[fake_tool]), patch(
            "app.core.langgraph.nodes.compose.llm_service.call", new=AsyncMock(side_effect=_fake_call)
        ):
            return await compose(state, _config())

    asyncio.run(_run())
    # Initial call + MAX_TOOL_ITERATIONS follow-ups.
    assert call_count == compose_module.MAX_TOOL_ITERATIONS + 1
