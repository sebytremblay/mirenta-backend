"""Unit tests for the voice scheduling tools + their HTTP client methods.

The client builds an ``httpx.AsyncClient`` per call, so we patch that symbol in
``mirenta_client`` to bind a ``MockTransport`` — the real request-building code
(URL, headers, JSON body) then runs against the mock without a live backend.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import httpx
import pytest

import mirenta_client
from mirenta_client import MirentaVoiceClient
from scheduling_tools import build_scheduling_tools


# Capture the real class up front — the patch below replaces the module symbol,
# so referencing it inside the factory would recurse.
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _patched_async_client(handler):
    """A drop-in for ``httpx.AsyncClient`` that routes requests to ``handler``."""

    def _factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return _REAL_ASYNC_CLIENT(*args, transport=httpx.MockTransport(handler), **kwargs)

    return _factory


@pytest.mark.asyncio
async def test_get_availability_posts_expected_request() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["key"] = request.headers.get("X-Mirenta-Internal-Key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"connected": True, "timezone": "UTC", "slots": []})

    client = MirentaVoiceClient(base_url="https://api.example.com", api_key="secret", api_prefix="/api")
    with patch.object(mirenta_client.httpx, "AsyncClient", _patched_async_client(handler)):
        result = await client.get_availability(org_id="o1", contact_id="c1", weekdays=["monday"])

    assert seen["path"] == "/api/internal/voice/availability"
    assert seen["key"] == "secret"
    assert seen["body"] == {"org_id": "o1", "contact_id": "c1", "weekdays": ["monday"]}
    assert result["connected"] is True


@pytest.mark.asyncio
async def test_schedule_meeting_posts_expected_request() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"booked": True, "connected": True, "sms_sent": True, "label": "Monday"})

    client = MirentaVoiceClient(base_url="https://api.example.com", api_key="secret", api_prefix="/api")
    with patch.object(mirenta_client.httpx, "AsyncClient", _patched_async_client(handler)):
        result = await client.schedule_meeting(
            org_id="o1",
            contact_id="c1",
            start="2026-07-20T09:00:00-07:00",
            end="2026-07-20T09:30:00-07:00",
            location="123 Main St",
        )

    assert seen["path"] == "/api/internal/voice/schedule-meeting"
    assert seen["body"]["location"] == "123 Main St"
    assert seen["body"]["start"] == "2026-07-20T09:00:00-07:00"
    assert result["sms_sent"] is True


@pytest.mark.asyncio
async def test_send_email_posts_expected_request() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"sent": True, "connected": True, "to": "a@b.com"})

    client = MirentaVoiceClient(base_url="https://api.example.com", api_key="secret", api_prefix="/api")
    with patch.object(mirenta_client.httpx, "AsyncClient", _patched_async_client(handler)):
        result = await client.send_email(
            org_id="o1",
            contact_id="c1",
            subject="Confirmed",
            body="See you Monday",
            to="a@b.com",
        )

    assert seen["path"] == "/api/internal/voice/send-email"
    assert seen["body"] == {
        "org_id": "o1",
        "contact_id": "c1",
        "subject": "Confirmed",
        "body": "See you Monday",
        "to": "a@b.com",
    }
    assert result["sent"] is True


def test_build_scheduling_tools_returns_three_tools() -> None:
    client = MirentaVoiceClient(base_url="https://api.example.com", api_key="secret", api_prefix="/api")
    tools = build_scheduling_tools(mirenta=client, org_id="o1", contact_id="c1")
    assert len(tools) == 3
