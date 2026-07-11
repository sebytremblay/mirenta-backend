"""Unit tests for app/services/clients/twilio_client.py's provisioning helpers."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import Fernet
from twilio.base.exceptions import TwilioRestException

from app.core.config import settings
from app.services.clients.twilio_client import (
    encrypt_twilio_auth_token,
    decrypt_twilio_auth_token,
    generate_voice_answer_twiml,
    generate_voice_reject_twiml,
    provision_org_twilio,
    send_sms,
)


def _make_fake_sub_client(*, available: list[str], purchased_phone_number: str | None) -> MagicMock:
    client = MagicMock()
    local = MagicMock()
    local.list_async = AsyncMock(return_value=[SimpleNamespace(phone_number=number) for number in available])
    client.available_phone_numbers.return_value.local = local
    client.incoming_phone_numbers.create_async = AsyncMock(
        return_value=SimpleNamespace(phone_number=purchased_phone_number, sid="PN123")
    )
    service = SimpleNamespace(sid="MG123")
    client.messaging.v1.services.create_async = AsyncMock(return_value=service)
    phone_numbers = MagicMock()
    phone_numbers.create_async = AsyncMock(return_value=SimpleNamespace(sid="PN123"))
    client.messaging.v1.services.return_value.phone_numbers = phone_numbers
    return client


def _make_fake_parent(*, sub_client: MagicMock) -> tuple[MagicMock, object]:
    parent = MagicMock()
    parent.api.accounts.create_async = AsyncMock(
        return_value=SimpleNamespace(sid="ACsub123", auth_token="sub-auth-token")
    )

    def _client(*, account_sid: str | None = None) -> MagicMock:
        if account_sid == "ACsub123":
            return sub_client
        return parent

    return parent, _client


def test_provision_org_twilio_creates_subaccount_number_and_messaging_service() -> None:
    sub = _make_fake_sub_client(available=["+15551234567"], purchased_phone_number="+15551234567")
    parent, client_factory = _make_fake_parent(sub_client=sub)

    with patch("app.services.clients.twilio_client.get_twilio_client", side_effect=client_factory):
        result = asyncio.run(provision_org_twilio(org_id="11111111-2222-3333-4444-555555555555", friendly_name="Acme"))

    assert result.phone_number == "+15551234567"
    assert result.subaccount_sid == "ACsub123"
    assert result.auth_token == "sub-auth-token"
    assert result.phone_sid == "PN123"
    assert result.messaging_service_sid == "MG123"
    parent.api.accounts.create_async.assert_awaited_once()
    sub.incoming_phone_numbers.create_async.assert_awaited_once()
    _, kwargs = sub.incoming_phone_numbers.create_async.call_args
    assert kwargs["phone_number"] == "+15551234567"
    assert kwargs["sms_url"].endswith(f"{settings.API_PREFIX}/webhooks/twilio/sms")
    assert kwargs["voice_url"].endswith(f"{settings.API_PREFIX}/webhooks/twilio/voice")
    sub.messaging.v1.services.create_async.assert_awaited_once()
    sub.messaging.v1.services.assert_called_with("MG123")
    sub.messaging.v1.services.return_value.phone_numbers.create_async.assert_awaited_once_with(
        phone_number_sid="PN123"
    )


def test_provision_org_twilio_raises_when_none_available() -> None:
    sub = _make_fake_sub_client(available=[], purchased_phone_number=None)
    _, client_factory = _make_fake_parent(sub_client=sub)

    with patch("app.services.clients.twilio_client.get_twilio_client", side_effect=client_factory):
        with pytest.raises(RuntimeError, match="no available twilio numbers"):
            asyncio.run(provision_org_twilio(org_id="11111111-2222-3333-4444-555555555555", friendly_name="Acme"))

    sub.incoming_phone_numbers.create_async.assert_not_awaited()


def test_provision_org_twilio_raises_on_purchase_failure() -> None:
    sub = _make_fake_sub_client(available=["+15551234567"], purchased_phone_number="+15551234567")
    sub.incoming_phone_numbers.create_async = AsyncMock(
        side_effect=TwilioRestException(status=400, uri="/IncomingPhoneNumbers", msg="number no longer available")
    )
    _, client_factory = _make_fake_parent(sub_client=sub)

    with patch("app.services.clients.twilio_client.get_twilio_client", side_effect=client_factory):
        with pytest.raises(TwilioRestException):
            asyncio.run(provision_org_twilio(org_id="11111111-2222-3333-4444-555555555555", friendly_name="Acme"))


def test_send_sms_prefers_messaging_service_sid() -> None:
    client = MagicMock()
    client.messages.create_async = AsyncMock(return_value=SimpleNamespace(sid="SM123"))

    with patch("app.services.clients.twilio_client.get_twilio_client", return_value=client) as get_client:
        sid = asyncio.run(
            send_sms(
                to="+15557654321",
                body="hello",
                from_="+15551234567",
                messaging_service_sid="MG123",
                subaccount_sid="ACsub123",
            )
        )

    assert sid == "SM123"
    get_client.assert_called_once_with(account_sid="ACsub123")
    _, kwargs = client.messages.create_async.call_args
    assert kwargs == {"to": "+15557654321", "messaging_service_sid": "MG123", "body": "hello"}


def test_encrypt_decrypt_twilio_auth_token_roundtrip() -> None:
    key = Fernet.generate_key().decode("utf-8")
    with patch.object(settings, "TWILIO_TOKEN_ENCRYPTION_KEY", key):
        encrypted = encrypt_twilio_auth_token("secret-token")
        assert encrypted != "secret-token"
        assert decrypt_twilio_auth_token(encrypted) == "secret-token"


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
