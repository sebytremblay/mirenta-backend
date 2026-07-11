"""Shared helpers for Twilio webhook routers (`signals.py`, `voice.py`).

Both the SMS and voice inbound webhooks need to reconstruct the
externally-visible request URL (to validate `X-Twilio-Signature` and, for
voice, to build the `wss://` Media Stream URL) and mark a `signals` row's
processing status.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import Request

from app.services.clients.supabase_client import execute_query


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
