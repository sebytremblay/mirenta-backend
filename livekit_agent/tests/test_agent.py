"""Unit tests for Mirenta voice-agent helpers (no LiveKit room / LLM required)."""

from __future__ import annotations

import httpx
import pytest

from call_context import (
    attr,
    infer_outcome,
    merge_call_context,
    parse_metadata,
)
from mirenta_client import MirentaVoiceClient


def test_parse_metadata_valid() -> None:
    assert parse_metadata('{"org_id": "o1", "contact_id": "c1"}') == {
        "org_id": "o1",
        "contact_id": "c1",
    }


def test_parse_metadata_invalid_or_empty() -> None:
    assert parse_metadata(None) == {}
    assert parse_metadata("") == {}
    assert parse_metadata("not-json") == {}
    assert parse_metadata("[1, 2]") == {}


def test_attr_prefers_first_nonempty_key() -> None:
    attrs = {"mirenta.org_id": "", "sip.h.x-mirenta-org-id": " org-1 "}
    assert attr(attrs, "mirenta.org_id", "sip.h.x-mirenta-org-id") == "org-1"
    assert attr(attrs, "missing") == ""


def test_infer_outcome() -> None:
    assert infer_outcome([]) == "no_answer"
    assert infer_outcome([{"role": "human", "content": "hi"}]) == "no_answer"
    assert (
        infer_outcome(
            [
                {"role": "human", "content": "hi"},
                {"role": "ai", "content": "hello"},
            ]
        )
        == "progressed"
    )


def test_merge_call_context_prefers_participant_attrs() -> None:
    attrs = {
        "mirenta.org_id": "o1",
        "mirenta.contact_id": "c1",
        "mirenta.signal_id": "s1",
        "mirenta.call_sid": "CA1",
    }
    assert merge_call_context(attrs, '{"org_id":"other"}', None) == {
        "org_id": "o1",
        "contact_id": "c1",
        "signal_id": "s1",
        "call_sid": "CA1",
    }


def test_merge_call_context_fills_from_metadata() -> None:
    attrs = {"mirenta.org_id": "o1"}
    job = '{"contact_id":"c1","signal_id":"s1","call_sid":"CA1"}'
    assert merge_call_context(attrs, job, None) == {
        "org_id": "o1",
        "contact_id": "c1",
        "signal_id": "s1",
        "call_sid": "CA1",
    }


def test_mirenta_client_url_and_headers() -> None:
    client = MirentaVoiceClient(
        base_url="https://api.example.com/",
        api_key="secret",  # pragma: allowlist secret
        api_prefix="/api/",
    )
    assert client._url("/internal/voice/bootstrap") == ("https://api.example.com/api/internal/voice/bootstrap")
    assert client._headers() == {
        "Content-Type": "application/json",
        "X-Mirenta-Internal-Key": "secret",
    }


def test_raise_for_status_includes_body() -> None:
    request = httpx.Request("POST", "https://api.example.com/x")
    response = httpx.Response(500, request=request, text="bootstrap boom")
    with pytest.raises(httpx.HTTPStatusError, match="bootstrap boom"):
        MirentaVoiceClient._raise_for_status(response)
