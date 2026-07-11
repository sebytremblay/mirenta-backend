"""Unit tests for app/core/langgraph/nodes/voice_compose.py."""

import asyncio
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables.config import RunnableConfig

from app.core.langgraph.nodes.voice_compose import compose
from app.core.langgraph.state import VoiceState


def test_compose_injects_knowledge_system_message() -> None:
    knowledge = "Organization knowledge (use only these facts; do not invent details):\n- [hours] Hours: Mon-Fri 9-5"
    state = VoiceState(messages=[HumanMessage(content="What are your hours?")])
    config: RunnableConfig = {
        "metadata": {
            "task_goal": "converse_inbound_call",
            "channel_constraints": {"max_length": 600},
            "knowledge": knowledge,
        }
    }
    captured_messages: list = []

    async def _fake_call(messages, model_name=None):
        captured_messages.extend(messages)
        return AIMessage(content="We're open Monday through Friday, nine to five.")

    async def _run():
        with patch("app.core.langgraph.nodes.voice_compose.llm_service.call", new=AsyncMock(side_effect=_fake_call)):
            return await compose(state, config)

    command = asyncio.run(_run())

    knowledge_messages = [message for message in captured_messages if knowledge in str(message.content)]
    assert len(knowledge_messages) == 1
    assert command.update["knowledge"] == knowledge
