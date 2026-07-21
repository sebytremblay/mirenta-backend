"""Unit tests for the post-meeting follow-up email activity.

Mocks ``send_org_email`` so the activity's orchestration (compose
deterministically, send to the captured recipient) runs without a live Google
account. The recipient is the customer email threaded onto the input, never a
DB read of the contact row — the contact is the realtor/org, not the caller.
"""

import asyncio
from unittest.mock import AsyncMock, patch

from activities import channels
from app.services.email import GoogleNotConnectedError, SentEmail


def _input(**overrides) -> channels.SendPostMeetingEmailInput:
    base = {
        "org_id": "org-1",
        "contact_id": "contact-1",
        "company_name": "Acme Realty",
        "recipient_email": "caller@example.com",
        "meeting_start": "2026-07-20T09:00:00-07:00",
        "meeting_location": "123 Main St",
    }
    base.update(overrides)
    return channels.SendPostMeetingEmailInput(**base)


def test_send_post_meeting_email_composes_and_sends() -> None:
    send = AsyncMock(return_value=SentEmail(message_id="msg-1", thread_id=None))
    with patch.object(channels, "send_org_email", send):
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
    with patch.object(channels, "send_org_email", send):
        result = asyncio.run(channels.send_post_meeting_email(_input(recipient_email=None)))

    assert result.sent is False
    assert result.connected is True
    assert result.to is None
    send.assert_not_awaited()


def test_send_post_meeting_email_reports_not_connected() -> None:
    with patch.object(channels, "send_org_email", AsyncMock(side_effect=GoogleNotConnectedError("org-1"))):
        result = asyncio.run(channels.send_post_meeting_email(_input()))

    assert result.sent is False
    assert result.connected is False
    assert result.to == "caller@example.com"
