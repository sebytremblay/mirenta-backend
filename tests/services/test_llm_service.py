"""Unit tests for LLMService per-call tool binding and its concurrency safety.

The point of the ``tools=`` parameter is that request-scoped tools bind to a
**fresh** per-attempt model instance (the one-off path) rather than mutating the
shared ``self._llm``. These tests prove two things:

1. per-call tools reach the invocation, and
2. concurrent calls with different tool sets never clobber each other or the
   shared default model.
"""

import asyncio
from typing import Any
from unittest.mock import patch

from langchain_core.messages import AIMessage

from app.services.llm.service import LLMService


class _FakeBoundModel:
    """A model with a specific tool set bound; echoes it back on invoke."""

    def __init__(self, tools: list[Any]) -> None:
        self._tools = tools

    async def ainvoke(self, _messages: Any) -> AIMessage:
        # Yield control so concurrent calls genuinely interleave under asyncio.
        await asyncio.sleep(0)
        names = [getattr(t, "name", t) for t in self._tools]
        return AIMessage(content=",".join(names))


class _FakeBaseModel:
    """Stands in for a registry ChatOpenAI instance.

    ``bind_tools`` returns a NEW object (never mutates self), mirroring the real
    LangChain contract that makes per-call binding concurrency-safe.
    """

    def __init__(self) -> None:
        self.bind_calls = 0

    def bind_tools(self, tools: list[Any]) -> _FakeBoundModel:
        self.bind_calls += 1
        return _FakeBoundModel(tools)

    async def ainvoke(self, _messages: Any) -> AIMessage:
        await asyncio.sleep(0)
        return AIMessage(content="no-tools")


class _NamedTool:
    def __init__(self, name: str) -> None:
        self.name = name


def _service_with_fake_registry() -> tuple[LLMService, _FakeBaseModel]:
    """Build an LLMService whose one-off path resolves to a fake base model."""
    base = _FakeBaseModel()
    service = LLMService()
    # Freeze self._llm to a sentinel so we can assert the default model is never
    # mutated by a per-call tools invocation.
    service._llm = "SENTINEL_DEFAULT_MODEL"  # type: ignore[assignment]
    return service, base


def test_per_call_tools_reach_invocation() -> None:
    service, base = _service_with_fake_registry()
    tools = [_NamedTool("lookup_org_knowledge")]

    with patch("app.services.llm.service.LLMRegistry.get", return_value=base):
        result = asyncio.run(service.call([], tools=tools))

    assert result.content == "lookup_org_knowledge"
    assert base.bind_calls == 1


def test_per_call_tools_do_not_mutate_default_model() -> None:
    service, base = _service_with_fake_registry()

    with patch("app.services.llm.service.LLMRegistry.get", return_value=base):
        asyncio.run(service.call([], tools=[_NamedTool("t1")]))

    # The shared default model is untouched — per-call tools went through the
    # non-mutating one-off path.
    assert service._llm == "SENTINEL_DEFAULT_MODEL"


def test_concurrent_calls_with_different_tools_do_not_clobber() -> None:
    service, base = _service_with_fake_registry()

    async def _run_both() -> tuple[Any, Any]:
        with patch("app.services.llm.service.LLMRegistry.get", return_value=base):
            a, b = await asyncio.gather(
                service.call([], tools=[_NamedTool("alpha")]),
                service.call([], tools=[_NamedTool("beta")]),
            )
        return a.content, b.content

    a_content, b_content = asyncio.run(_run_both())

    # Each concurrent call saw only its own tool set.
    assert a_content == "alpha"
    assert b_content == "beta"
    assert service._llm == "SENTINEL_DEFAULT_MODEL"


def test_no_tools_uses_default_path_untouched() -> None:
    """Regression guard: omitting tools must not take the one-off path."""
    service, _ = _service_with_fake_registry()

    async def _fake_default(_messages: Any) -> AIMessage:
        await asyncio.sleep(0)
        return AIMessage(content="default-path")

    # Default path invokes self._llm directly; swap it for a callable fake.
    class _DefaultModel:
        ainvoke = staticmethod(_fake_default)

    service._llm = _DefaultModel()  # type: ignore[assignment]
    result = asyncio.run(service.call([]))
    assert result.content == "default-path"
