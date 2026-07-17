"""Unit tests for the tagged example tools (read-only + durable patterns)."""

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.agent_tools.context import ToolContext
from app.agent_tools.examples import (
    LookupKnowledgeArgs,
    RequestMeetingArgs,
    lookup_org_knowledge,
    request_meeting,
)
from app.schemas.knowledge import Knowledge


def _context(channel: str = "voice") -> ToolContext:
    return ToolContext(org_id="org-1", contact_id="contact-1", channel=channel)


def _knowledge_row() -> Knowledge:
    return Knowledge(
        id=uuid4(),
        org_id=uuid4(),
        kind="hours",
        title="Opening hours",
        content="Open 9 to 5, Monday through Friday.",
        metadata={},
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def test_lookup_org_knowledge_returns_formatted_block() -> None:
    with patch(
        "app.agent_tools.examples.fetch_active_knowledge",
        new=AsyncMock(return_value=[_knowledge_row()]),
    ):
        result = asyncio.run(lookup_org_knowledge(_context(), LookupKnowledgeArgs(topic="hours")))
    assert "Organization knowledge" in result
    assert "[hours] Opening hours" in result


def test_lookup_org_knowledge_handles_empty_kb() -> None:
    with patch(
        "app.agent_tools.examples.fetch_active_knowledge",
        new=AsyncMock(return_value=[]),
    ):
        result = asyncio.run(lookup_org_knowledge(_context(), LookupKnowledgeArgs(topic="hours")))
    assert "No knowledge base entries" in result


def test_request_meeting_routes_through_temporal_when_available() -> None:
    emit = AsyncMock(return_value="sig-123")
    with patch("app.agent_tools.examples.temporal_available", return_value="localhost:7233"), patch(
        "app.agent_tools.examples.emit_tool_signal", new=emit
    ):
        result = asyncio.run(
            request_meeting(_context(), RequestMeetingArgs(preferred_time="Tuesday afternoon", notes="prefers video"))
        )

    # The durable tool must NOT book inline — it emits a signal and acks.
    emit.assert_awaited_once()
    _, kwargs = emit.call_args
    assert kwargs["signal_type"] == "manual"
    assert kwargs["payload"]["tool"] == "request_meeting"
    assert kwargs["payload"]["preferred_time"] == "Tuesday afternoon"
    assert "follow up" in result.lower()


def test_request_meeting_degrades_without_temporal() -> None:
    emit = AsyncMock()
    with patch("app.agent_tools.examples.temporal_available", return_value=None), patch(
        "app.agent_tools.examples.emit_tool_signal", new=emit
    ):
        result = asyncio.run(
            request_meeting(_context(), RequestMeetingArgs(preferred_time="Tuesday"))
        )

    # No durable runtime => acknowledge without pretending it persisted.
    emit.assert_not_awaited()
    assert "not available" in result.lower()
