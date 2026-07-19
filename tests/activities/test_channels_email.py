"""Unit tests for the post-meeting follow-up email activity.

Mocks the service-role client and ``send_org_email`` so the activity's
orchestration (load recipient, compose deterministically, send) runs without a
live database or Google account.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from activities import channels
from app.services.email import GoogleNotConnectedError, SentEmail


def _input(**overrides) -> channels.SendPostMeetingEmailInput:
    base = {
        "org_id": "org-1",
        "contact_id": "contact-1",
        "company_name": "Acme Realty",
        "meeting_start": "2026-07-20T09:00:00-07:00",
        "meeting_location": "123 Main St",
    }
    base.update(overrides)
    return channels.SendPostMeetingEmailInput(**base)


def test_send_post_meeting_email_composes_and_sends() -> None:
    send = AsyncMock(return_value=SentEmail(message_id="msg-1", thread_id=None))
    with (
        patch.object(channels, "get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch.object(
            channels,
            "execute_query",
            AsyncMock(return_value=SimpleNamespace(data={"email": "caller@example.com"})),
        ),
        patch.object(channels, "send_org_email", send),
    ):
        result = asyncio.run(channels.send_post_meeting_email(_input()))

    assert result.sent is True
    assert result.connected is True
    assert result.to == "caller@example.com"
    assert result.message_id == "msg-1"
    _, kwargs = send.call_args
    assert kwargs["to"] == "caller@example.com"
    assert "Acme Realty" in kwargs["body"]
    assert "123 Main St" in kwargs["body"]


def test_send_post_meeting_email_skips_when_no_recipient() -> None:
    send = AsyncMock()
    with (
        patch.object(channels, "get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch.object(
            channels,
            "execute_query",
            AsyncMock(return_value=SimpleNamespace(data={"email": None})),
        ),
        patch.object(channels, "send_org_email", send),
    ):
        result = asyncio.run(channels.send_post_meeting_email(_input()))

    assert result.sent is False
    assert result.connected is True
    assert result.to is None
    send.assert_not_awaited()


def test_send_post_meeting_email_reports_not_connected() -> None:
    with (
        patch.object(channels, "get_service_role_client", AsyncMock(return_value=MagicMock())),
        patch.object(
            channels,
            "execute_query",
            AsyncMock(return_value=SimpleNamespace(data={"email": "caller@example.com"})),
        ),
        patch.object(channels, "send_org_email", AsyncMock(side_effect=GoogleNotConnectedError("org-1"))),
    ):
        result = asyncio.run(channels.send_post_meeting_email(_input()))

    assert result.sent is False
    assert result.connected is False
    assert result.to == "caller@example.com"
