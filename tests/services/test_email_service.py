"""Unit tests for the email service's I/O orchestration.

Mocks the credential load, token refresh, and Gmail send to check
``send_org_email`` wires them together and surfaces the not-connected error.
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services import email
from app.services.calendar import GoogleCredential
from app.services.email import (
    GoogleNotConnectedError,
    SentEmail,
    build_meeting_confirmation_email,
    build_post_meeting_email,
    send_org_email,
)


def _credential() -> GoogleCredential:
    return GoogleCredential(refresh_token="refresh-abc", calendar_id="primary")


def test_send_org_email_refreshes_token_and_sends() -> None:
    send = AsyncMock(return_value={"id": "msg-1", "threadId": "thr-1"})
    with patch.object(email, "load_org_google_credential", new=AsyncMock(return_value=_credential())), patch.object(
        email, "refresh_access_token", new=AsyncMock(return_value="access-token")
    ) as refresh, patch.object(email, "send_gmail", new=send):
        result = asyncio.run(
            send_org_email(org_id="org-1", to="a@b.com", subject="Confirmed", body="See you then")
        )

    refresh.assert_awaited_once_with("refresh-abc")
    _, kwargs = send.call_args
    assert kwargs["to"] == "a@b.com"
    assert kwargs["subject"] == "Confirmed"
    assert isinstance(result, SentEmail)
    assert result.message_id == "msg-1"
    assert result.thread_id == "thr-1"


def test_send_org_email_raises_when_not_connected() -> None:
    with patch.object(
        email, "load_org_google_credential", new=AsyncMock(side_effect=GoogleNotConnectedError("org-1"))
    ):
        with pytest.raises(GoogleNotConnectedError):
            asyncio.run(send_org_email(org_id="org-1", to="a@b.com", subject="s", body="b"))


def test_build_meeting_confirmation_email_states_when_and_where() -> None:
    subject, body = build_meeting_confirmation_email(
        company_name="Acme Realty", when_label="Monday, July 20 at 9:00 AM", location="123 Main St"
    )
    assert "Acme Realty" in subject
    assert "confirmed" in body
    assert "Monday, July 20 at 9:00 AM" in body
    assert "123 Main St" in body


def test_build_meeting_confirmation_email_omits_location_when_absent() -> None:
    _, body = build_meeting_confirmation_email(
        company_name="Acme Realty", when_label="Monday at 9:00 AM", location=None
    )
    assert " at " in body  # the time label keeps its own "at"
    assert "None" not in body


def test_build_post_meeting_email_thanks_the_contact() -> None:
    subject, body = build_post_meeting_email(
        company_name="Acme Realty", when_label="Monday, July 20 at 9:00 AM", location="123 Main St"
    )
    assert "Thanks" in subject or "Thank" in subject
    assert "Acme Realty" in body
    assert "123 Main St" in body
