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
    get_twilio_client,
    provision_org_twilio,
    send_sms,
)


def _make_fake_sub_client(*, purchased_phone_number: str | None) -> MagicMock:
    client = MagicMock()
    client.incoming_phone_numbers.create_async = AsyncMock(
        return_value=SimpleNamespace(phone_number=purchased_phone_number, sid="PN123")
    )
    service = SimpleNamespace(sid="MG123")
    client.messaging.v1.services.create_async = AsyncMock(return_value=service)
    phone_numbers = MagicMock()
    phone_numbers.create_async = AsyncMock(return_value=SimpleNamespace(sid="PN123"))
    client.messaging.v1.services.return_value.phone_numbers = phone_numbers
    return client


def _make_fake_parent(*, available: list[str]) -> MagicMock:
    parent = MagicMock()
    parent.api.accounts.create_async = AsyncMock(
        return_value=SimpleNamespace(sid="ACsub123", auth_token="sub-auth-token")
    )
    local = MagicMock()
    local.list_async = AsyncMock(return_value=[SimpleNamespace(phone_number=number) for number in available])
    parent.available_phone_numbers.return_value.local = local
    return parent


def test_provision_org_twilio_creates_subaccount_number_and_messaging_service() -> None:
    parent = _make_fake_parent(available=["+15551234567"])
    sub = _make_fake_sub_client(purchased_phone_number="+15551234567")

    def _client(*, account_sid: str | None = None, auth_token: str | None = None) -> MagicMock:
        if account_sid == "ACsub123" and auth_token == "sub-auth-token":
            return sub
        return parent

    with (
        patch("app.services.clients.twilio_client.get_twilio_client", side_effect=_client) as get_client,
        patch("app.services.clients.twilio_client._require_parent_account_credentials"),
    ):
        result = asyncio.run(provision_org_twilio(org_id="11111111-2222-3333-4444-555555555555", friendly_name="Acme"))

    assert result.phone_number == "+15551234567"
    assert result.subaccount_sid == "ACsub123"
    assert result.auth_token == "sub-auth-token"
    assert result.phone_sid == "PN123"
    assert result.messaging_service_sid == "MG123"
    parent.api.accounts.create_async.assert_awaited_once()
    parent.available_phone_numbers.assert_called_with("US")
    assert get_client.call_args_list[-1].kwargs == {
        "account_sid": "ACsub123",
        "auth_token": "sub-auth-token",
    }
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
    parent = _make_fake_parent(available=[])
    sub = _make_fake_sub_client(purchased_phone_number=None)

    def _client(*, account_sid: str | None = None, auth_token: str | None = None) -> MagicMock:
        if account_sid == "ACsub123":
            return sub
        return parent

    with (
        patch("app.services.clients.twilio_client.get_twilio_client", side_effect=_client),
        patch("app.services.clients.twilio_client._require_parent_account_credentials"),
    ):
        with pytest.raises(RuntimeError, match="no available twilio numbers"):
            asyncio.run(provision_org_twilio(org_id="11111111-2222-3333-4444-555555555555", friendly_name="Acme"))

    sub.incoming_phone_numbers.create_async.assert_not_awaited()


def test_provision_org_twilio_raises_when_auth_token_missing() -> None:
    parent = _make_fake_parent(available=["+15551234567"])
    parent.api.accounts.create_async = AsyncMock(return_value=SimpleNamespace(sid="ACsub123", auth_token=""))

    with (
        patch("app.services.clients.twilio_client.get_twilio_client", return_value=parent),
        patch("app.services.clients.twilio_client._require_parent_account_credentials"),
    ):
        with pytest.raises(RuntimeError, match="returned no auth_token"):
            asyncio.run(provision_org_twilio(org_id="11111111-2222-3333-4444-555555555555", friendly_name="Acme"))


def test_provision_org_twilio_raises_on_purchase_failure() -> None:
    parent = _make_fake_parent(available=["+15551234567"])
    sub = _make_fake_sub_client(purchased_phone_number="+15551234567")
    sub.incoming_phone_numbers.create_async = AsyncMock(
        side_effect=TwilioRestException(status=400, uri="/IncomingPhoneNumbers", msg="number no longer available")
    )

    def _client(*, account_sid: str | None = None, auth_token: str | None = None) -> MagicMock:
        if account_sid == "ACsub123":
            return sub
        return parent

    with (
        patch("app.services.clients.twilio_client.get_twilio_client", side_effect=_client),
        patch("app.services.clients.twilio_client._require_parent_account_credentials"),
    ):
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
                auth_token="sub-auth-token",
            )
        )

    assert sid == "SM123"
    get_client.assert_called_once_with(account_sid="ACsub123", auth_token="sub-auth-token")
    _, kwargs = client.messages.create_async.call_args
    assert kwargs == {"to": "+15557654321", "messaging_service_sid": "MG123", "body": "hello"}


def test_get_twilio_client_requires_auth_token_for_subaccount() -> None:
    with patch.object(settings, "TWILIO_ACCOUNT_SID", "ACparent"):
        with patch.object(settings, "TWILIO_AUTH_TOKEN", "parent-token"):
            with pytest.raises(ValueError, match="requires auth_token"):
                get_twilio_client(account_sid="ACsub123")


def test_get_twilio_client_uses_subaccount_credentials_when_provided() -> None:
    with patch("app.services.clients.twilio_client.Client") as client_cls:
        with patch("app.services.clients.twilio_client.AsyncTwilioHttpClient", return_value=MagicMock()):
            get_twilio_client(account_sid="ACsub123", auth_token="sub-auth-token")

    client_cls.assert_called_once()
    args, kwargs = client_cls.call_args
    assert args[:2] == ("ACsub123", "sub-auth-token")
    assert "http_client" in kwargs


def test_encrypt_decrypt_twilio_auth_token_roundtrip() -> None:
    key = Fernet.generate_key().decode("utf-8")
    with patch.object(settings, "TWILIO_TOKEN_ENCRYPTION_KEY", key):
        encrypted = encrypt_twilio_auth_token("secret-token")
        assert encrypted != "secret-token"
        assert decrypt_twilio_auth_token(encrypted) == "secret-token"


def test_generate_voice_answer_twiml_dials_livekit_sip() -> None:
    twiml = generate_voice_answer_twiml(
        sip_uri="sip:call-CA123@example.sip.livekit.cloud;transport=tcp",
        sip_username="trunk-user",
        sip_password="trunk-pass",  # pragma: allowlist secret
    )

    assert "<Dial" in twiml
    assert "sip:call-CA123@example.sip.livekit.cloud;transport=tcp" in twiml
    assert 'username="trunk-user"' in twiml


def test_generate_voice_reject_twiml_says_and_hangs_up() -> None:
    twiml = generate_voice_reject_twiml(message="We are unable to take your call.")

    assert "<Say>We are unable to take your call.</Say>" in twiml
    assert "<Hangup" in twiml
