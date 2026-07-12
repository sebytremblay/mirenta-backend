"""Shared helpers for Twilio webhook routers (`signals.py`, `voice.py`).

Both the SMS and voice inbound webhooks need to reconstruct the
externally-visible request URL (to validate `X-Twilio-Signature`) and mark a
`signals` row's processing status.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from twilio.request_validator import RequestValidator

from app.core.config import settings
from app.core.logging import logger
from app.services.clients.supabase_client import execute_query
from app.services.clients.twilio_client import decrypt_twilio_auth_token


def public_request_url(request: Request) -> str:
    """Reconstruct the externally-visible URL Twilio signed the request against.

    Behind a TLS-terminating proxy, `request.url` reflects the proxy-to-app
    hop (often plain `http`), which would make every signature check fail —
    so prefer `X-Forwarded-Proto`/`X-Forwarded-Host` when present.

    Args:
        request: The incoming FastAPI request.

    Returns:
        str: The public-facing URL Twilio actually requested.
    """
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.url.netloc)
    query = f"?{request.url.query}" if request.url.query else ""
    return f"{proto}://{host}{request.url.path}{query}"


async def mark_signal_status(client: Any, signal_id: str, status: str) -> None:
    """Update a `signals` row's processing status.

    Args:
        client: A Supabase service-role client.
        signal_id: The signal to update.
        status: The new `SignalStatus` value.
    """
    await execute_query(
        client.table("signals")
        .update({"status": status, "processed_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", signal_id)
    )


async def load_org_twilio_auth_token(client: Any, org_id: str) -> str | None:
    """Decrypt the org's subaccount Auth Token, or None if not provisioned."""
    response = await execute_query(
        client.table("organization_twilio_secrets").select("auth_token_encrypted").eq("org_id", org_id).limit(1)
    )
    if not response.data:
        return None
    try:
        return decrypt_twilio_auth_token(response.data[0]["auth_token_encrypted"])
    except Exception:
        logger.exception("twilio_auth_token_decrypt_failed", org_id=org_id)
        return None


async def resolve_twilio_auth_token(client: Any, org_id: str | None) -> str:
    """Auth token used to validate `X-Twilio-Signature` for this org's webhooks.

    Subaccount-owned numbers are signed with the subaccount token (stored
    encrypted in `organization_twilio_secrets`). Legacy numbers still on the
    parent account fall back to `TWILIO_AUTH_TOKEN`.
    """
    if org_id:
        token = await load_org_twilio_auth_token(client, org_id)
        if token:
            return token
    return settings.TWILIO_AUTH_TOKEN


async def validate_twilio_signature(
    request: Request,
    params: dict[str, str],
    client: Any,
    *,
    org_id: str | None,
) -> bool:
    """Validate Twilio's request signature with the org or parent Auth Token."""
    auth_token = await resolve_twilio_auth_token(client, org_id)
    validator = RequestValidator(auth_token)
    return validator.validate(public_request_url(request), params, request.headers.get("X-Twilio-Signature", ""))
