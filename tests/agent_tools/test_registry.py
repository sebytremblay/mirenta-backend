"""Unit tests for the channel-neutral agent-tool registry and filtering."""

import pytest
from pydantic import BaseModel

from app.agent_tools.context import ToolContext
from app.agent_tools.registry import AgentTool, get_tools, register


class _Args(BaseModel):
    value: str


def _context(channel: str = "sms") -> ToolContext:
    return ToolContext(org_id="org-1", contact_id="contact-1", channel=channel)


def test_register_rejects_duplicate_names() -> None:
    args = _Args

    @register(name="dup_tool_unique_xyz", description="d", args_model=args, tags=["test"])
    async def _first(context: ToolContext, a: _Args) -> str:
        return a.value

    with pytest.raises(ValueError, match="already registered"):

        @register(name="dup_tool_unique_xyz", description="d", args_model=args, tags=["test"])
        async def _second(context: ToolContext, a: _Args) -> str:
            return a.value


def test_allows_channel_respects_allowlist() -> None:
    voice_only = AgentTool(
        name="voice_thing",
        description="d",
        args_model=_Args,
        fn=lambda c, a: a,  # type: ignore[arg-type,return-value]
        channels=frozenset({"voice"}),
    )
    assert voice_only.allows_channel("voice") is True
    assert voice_only.allows_channel("sms") is False


def test_allows_channel_none_means_all() -> None:
    anywhere = AgentTool(name="any_thing", description="d", args_model=_Args, fn=lambda c, a: a)  # type: ignore[arg-type,return-value]
    assert anywhere.allows_channel("sms") is True
    assert anywhere.allows_channel("voice") is True
    assert anywhere.allows_channel("email") is True


def test_get_tools_filters_by_channel_and_tag() -> None:
    example_tools = get_tools(tags=["example"])
    assert example_tools, "example tools should be discoverable via the tag"

    names = {t.name for t in example_tools}
    assert "lookup_org_knowledge" in names
    assert "request_meeting" in names

    # request_meeting is voice/sms only; an email-channel query drops it.
    email_examples = {t.name for t in get_tools(channel="email", tags=["example"])}
    assert "lookup_org_knowledge" in email_examples
    assert "request_meeting" not in email_examples
