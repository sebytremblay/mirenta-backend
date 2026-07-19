"""Unit tests for the Gmail send path in the Google client.

Mocks only the network boundary (Google's ``messages/send``) via an
``httpx.MockTransport``, exercising the real MIME build + base64url encoding and
request shaping. Nothing here hits a live Google account.
"""

from __future__ import annotations

import asyncio
import base64
import email
import json
from email.policy import default as default_policy
from unittest.mock import patch

import httpx

from app.services.clients import google_client
from app.services.clients.google_client import _build_raw_message, send_gmail

_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _patched_async_client(handler):
    """A drop-in for ``httpx.AsyncClient`` that routes requests to ``handler``."""

    def _factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return _REAL_ASYNC_CLIENT(*args, transport=httpx.MockTransport(handler), **kwargs)

    return _factory


def test_build_raw_message_is_base64url_decodable_mime() -> None:
    raw = _build_raw_message(sender=None, to="a@b.com", subject="Hi there", body="Line one\nLine two")
    decoded = base64.urlsafe_b64decode(raw.encode("utf-8"))
    message = email.message_from_bytes(decoded, policy=default_policy)

    assert message["To"] == "a@b.com"
    assert message["Subject"] == "Hi there"
    assert "From" not in message
    assert "Line one" in message.get_content()


def test_build_raw_message_sets_from_when_sender_given() -> None:
    raw = _build_raw_message(sender="office@x.com", to="a@b.com", subject="s", body="b")
    message = email.message_from_bytes(base64.urlsafe_b64decode(raw.encode("utf-8")), policy=default_policy)
    assert message["From"] == "office@x.com"


def test_send_gmail_posts_raw_to_messages_send() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["host"] = request.url.host
        seen["auth"] = request.headers.get("Authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "msg-1", "threadId": "thr-1"})

    with patch.object(google_client.httpx, "AsyncClient", _patched_async_client(handler)):
        result = asyncio.run(send_gmail("access-token", to="a@b.com", subject="s", body="b"))

    assert seen["host"] == "gmail.googleapis.com"
    assert seen["path"] == "/gmail/v1/users/me/messages/send"
    assert seen["auth"] == "Bearer access-token"
    # The body carries a single base64url raw field that decodes to our MIME.
    decoded = base64.urlsafe_b64decode(seen["body"]["raw"].encode("utf-8"))
    assert b"a@b.com" in decoded
    assert result["id"] == "msg-1"
    assert result["threadId"] == "thr-1"
