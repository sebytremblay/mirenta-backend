"""Unit tests for app/services/twilio_client.py's number-provisioning helpers."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from twilio.base.exceptions import TwilioRestException

from app.core.config import settings
from app.services.twilio_client import (
    generate_voice_answer_twiml,
    generate_voice_reject_twiml,
    provision_phone_number,
)


def _make_fake_client(*, available: list[str], purchased_phone_number: str | None) -> MagicMock:
    client = MagicMock()
    local = MagicMock()
    local.list_async = AsyncMock(return_value=[SimpleNamespace(phone_number=number) for number in available])
    client.available_phone_numbers.return_value.local = local
    client.incoming_phone_numbers.create_async = AsyncMock(
        return_value=SimpleNamespace(phone_number=purchased_phone_number)
    )
    return client


def test_provision_phone_number_purchases_first_available_number() -> None:
    client = _make_fake_client(available=["+15551234567"], purchased_phone_number="+15551234567")

    with patch("app.services.twilio_client.get_twilio_client", return_value=client):
        phone_number = asyncio.run(provision_phone_number())

    assert phone_number == "+15551234567"
    client.incoming_phone_numbers.create_async.assert_awaited_once()
    _, kwargs = client.incoming_phone_numbers.create_async.call_args
    assert kwargs["phone_number"] == "+15551234567"
    assert kwargs["sms_url"].endswith(f"{settings.API_V1_STR}/webhooks/twilio/sms")
    assert kwargs["sms_method"] == "POST"
    assert kwargs["voice_url"].endswith(f"{settings.API_V1_STR}/webhooks/twilio/voice")
    assert kwargs["voice_method"] == "POST"


def test_provision_phone_number_raises_when_none_available() -> None:
    client = _make_fake_client(available=[], purchased_phone_number=None)

    with patch("app.services.twilio_client.get_twilio_client", return_value=client):
        with pytest.raises(RuntimeError, match="no available twilio numbers"):
            asyncio.run(provision_phone_number())

    client.incoming_phone_numbers.create_async.assert_not_awaited()


def test_provision_phone_number_raises_on_purchase_failure() -> None:
    client = _make_fake_client(available=["+15551234567"], purchased_phone_number="+15551234567")
    client.incoming_phone_numbers.create_async = AsyncMock(
        side_effect=TwilioRestException(status=400, uri="/IncomingPhoneNumbers", msg="number no longer available")
    )

    with patch("app.services.twilio_client.get_twilio_client", return_value=client):
        with pytest.raises(TwilioRestException):
            asyncio.run(provision_phone_number())


def test_generate_voice_answer_twiml_connects_stream_with_parameters() -> None:
    twiml = generate_voice_answer_twiml(
        stream_url="wss://example.test/api/v1/ws/twilio/voice/CA123",
        org_id="org-1",
        contact_id="contact-1",
        signal_id="signal-1",
    )

    assert '<Connect><Stream url="wss://example.test/api/v1/ws/twilio/voice/CA123">' in twiml
    assert '<Parameter name="org_id" value="org-1"' in twiml
    assert '<Parameter name="contact_id" value="contact-1"' in twiml
    assert '<Parameter name="signal_id" value="signal-1"' in twiml


def test_generate_voice_reject_twiml_says_and_hangs_up() -> None:
    twiml = generate_voice_reject_twiml(message="We are unable to take your call.")

    assert "<Say>We are unable to take your call.</Say>" in twiml
    assert "<Hangup" in twiml
