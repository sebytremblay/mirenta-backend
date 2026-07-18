"""Unit tests for the OAuth ``state`` sign/verify round-trip.

``state`` carries the org id across Google's un-authenticated callback and
doubles as CSRF/replay defense (HMAC + short TTL). These tests pin that the
signature and expiry behave, since a weakness here is a real auth hole.
"""

import time
from unittest.mock import _patch, patch

import pytest

from app.api.routers import google_oauth


def _with_secret() -> "_patch[str]":
    return patch.object(google_oauth.settings, "MIRENTA_INTERNAL_API_KEY", "unit-test-secret")


def test_sign_then_verify_returns_org_id() -> None:
    with _with_secret():
        state = google_oauth._sign_state("org-123")
        assert google_oauth._verify_state(state) == "org-123"


def test_verify_rejects_tampered_org_id() -> None:
    with _with_secret():
        state = google_oauth._sign_state("org-123")
        org_id, issued_at, nonce, signature = state.split(".")
        forged = f"org-999.{issued_at}.{nonce}.{signature}"
        with pytest.raises(ValueError):
            google_oauth._verify_state(forged)


def test_verify_rejects_expired_state() -> None:
    with _with_secret():
        state = google_oauth._sign_state("org-123")
    # Jump past the TTL so the freshly-minted state reads as expired.
    with _with_secret(), patch.object(time, "time", return_value=time.time() + google_oauth._STATE_TTL_SECONDS + 5):
        with pytest.raises(ValueError):
            google_oauth._verify_state(state)


def test_verify_rejects_malformed_state() -> None:
    with _with_secret():
        with pytest.raises(ValueError):
            google_oauth._verify_state("not-a-valid-state")


def test_signature_depends_on_secret() -> None:
    with patch.object(google_oauth.settings, "MIRENTA_INTERNAL_API_KEY", "secret-a"):
        state = google_oauth._sign_state("org-123")
    # A different signing secret must reject a state signed under the old one.
    with patch.object(google_oauth.settings, "MIRENTA_INTERNAL_API_KEY", "secret-b"):
        with pytest.raises(ValueError):
            google_oauth._verify_state(state)
