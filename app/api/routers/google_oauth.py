"""Google Calendar OAuth endpoints (backend-hosted flow).

Realtors connect their Google Calendar from the dashboard. The website never
handles the Google client secret or the tokens — the whole flow lives here:

- ``GET /integrations/google/start`` (Supabase JWT): authorize the caller for
  the org, mint a signed ``state``, and return Google's consent URL. The website
  redirects the browser to it.
- ``GET /integrations/google/callback`` (no JWT — Google redirects the browser
  here): verify ``state``, exchange the code, encrypt + upsert the refresh token
  via the service-role client, then redirect back to the dashboard with a
  result flag.
- ``GET /integrations/google/status`` (Supabase JWT): whether the org has a
  connected calendar, for the settings UI.

``state`` is an HMAC-signed ``org_id.issued_at.nonce`` triple (secret =
``MIRENTA_INTERNAL_API_KEY``). It both round-trips the org id across the
un-authenticated callback and defends against CSRF/replay via a short expiry.
"""

import hashlib
import hmac
import secrets
import time
from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.api.deps import assert_org_member
from app.api.routers.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.schemas.auth import SupabaseUser
from app.services.clients.google_client import build_authorize_url, exchange_code, encrypt_refresh_token
from app.services.clients.supabase_client import execute_query, get_service_role_client

router = APIRouter()

# A connect attempt must finish within this window (seconds).
_STATE_TTL_SECONDS = 600


class GoogleAuthorizeResponse(BaseModel):
    """Response for the start endpoint: where to send the browser next."""

    authorize_url: str = Field(..., description="Google consent URL to redirect the browser to")


class GoogleStatusResponse(BaseModel):
    """Whether an org has a connected Google Calendar."""

    connected: bool = Field(..., description="True when a refresh token is stored for the org")
    google_email: str | None = Field(default=None, description="Connected Google account email, when known")


def _sign_state(org_id: str) -> str:
    """Build an HMAC-signed ``org_id.issued_at.nonce.sig`` state string."""
    issued_at = str(int(time.time()))
    nonce = secrets.token_urlsafe(16)
    payload = f"{org_id}.{issued_at}.{nonce}"
    signature = hmac.new(_state_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def _verify_state(state: str) -> str:
    """Verify a signed state string and return the org id.

    Raises:
        ValueError: If the signature is invalid or the state has expired.
    """
    try:
        org_id, issued_at, nonce, signature = state.split(".")
    except ValueError as e:
        raise ValueError("malformed oauth state") from e
    payload = f"{org_id}.{issued_at}.{nonce}"
    expected = hmac.new(_state_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise ValueError("oauth state signature mismatch")
    if int(time.time()) - int(issued_at) > _STATE_TTL_SECONDS:
        raise ValueError("oauth state expired")
    return org_id


def _state_secret() -> bytes:
    """Secret used to sign OAuth state — reuses the internal API key."""
    secret = settings.MIRENTA_INTERNAL_API_KEY
    if not secret:
        raise RuntimeError("MIRENTA_INTERNAL_API_KEY is required to sign google oauth state")
    return secret.encode("utf-8")


def _dashboard_redirect(status: str) -> RedirectResponse:
    """Redirect the browser back to the dashboard settings page with a flag."""
    query = urlencode({"google": status})
    return RedirectResponse(url=f"{settings.WEBSITE_BASE_URL.rstrip('/')}/settings?{query}")


@router.get("/integrations/google/start", response_model=GoogleAuthorizeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["integrations"][0])
async def start_google_connect(
    request: Request,
    org_id: UUID,
    user: SupabaseUser = Depends(get_current_user),
) -> GoogleAuthorizeResponse:
    """Return Google's consent URL for the caller's org.

    Args:
        request: FastAPI request (required by slowapi).
        org_id: The organization to connect a calendar for.
        user: The authenticated Supabase user (must be an org member).

    Returns:
        GoogleAuthorizeResponse: The consent URL to redirect the browser to.
    """
    _ = request
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google integration is not configured")
    await assert_org_member(user, org_id)
    authorize_url = build_authorize_url(_sign_state(str(org_id)))
    logger.info("google_connect_started", org_id=str(org_id), user_id=str(user.id))
    return GoogleAuthorizeResponse(authorize_url=authorize_url)


@router.get("/integrations/google/callback")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["integrations"][0])
async def google_oauth_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Handle Google's redirect: exchange the code and store the refresh token.

    No JWT here — the caller is the user's browser following Google's redirect,
    so authorization rides on the signed ``state``. Always redirects back to the
    dashboard rather than returning JSON.

    Args:
        request: FastAPI request (required by slowapi).
        state: Signed state minted by the start endpoint.
        code: Google authorization code (present on success).
        error: Google error code (present when the user declines).

    Returns:
        RedirectResponse: Back to the dashboard with ``?google=connected|error``.
    """
    _ = request
    if error or not code or not state:
        logger.warning("google_callback_declined_or_missing", error=error, has_code=bool(code))
        return _dashboard_redirect("error")

    try:
        org_id = _verify_state(state)
    except ValueError:
        logger.warning("google_callback_invalid_state")
        return _dashboard_redirect("error")

    try:
        tokens = await exchange_code(code)
    except Exception:
        logger.exception("google_callback_exchange_failed", org_id=org_id)
        return _dashboard_redirect("error")

    if not tokens.refresh_token:
        # Google only returns a refresh token on first consent for a grant.
        # prompt=consent forces one; a missing token means the grant is in a bad
        # state — surface it so the realtor can revoke + reconnect.
        logger.warning("google_callback_no_refresh_token", org_id=org_id)
        return _dashboard_redirect("error")

    try:
        client = await get_service_role_client()
        await execute_query(
            client.table("organization_google_credentials").upsert(
                {
                    "org_id": org_id,
                    "refresh_token_encrypted": encrypt_refresh_token(tokens.refresh_token),
                    "google_email": tokens.email,
                    "scope": tokens.scope,
                }
            )
        )
    except APIError:
        logger.exception("google_callback_store_failed", org_id=org_id)
        return _dashboard_redirect("error")

    logger.info("google_calendar_connected", org_id=org_id, google_email=tokens.email)
    return _dashboard_redirect("connected")


@router.get("/integrations/google/status", response_model=GoogleStatusResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["integrations"][0])
async def google_connection_status(
    request: Request,
    org_id: UUID,
    user: SupabaseUser = Depends(get_current_user),
) -> GoogleStatusResponse:
    """Report whether the caller's org has a connected Google Calendar.

    Args:
        request: FastAPI request (required by slowapi).
        org_id: The organization to check.
        user: The authenticated Supabase user (must be an org member).

    Returns:
        GoogleStatusResponse: Connection state + connected email when present.
    """
    _ = request
    await assert_org_member(user, org_id)
    client = await get_service_role_client()
    response = await execute_query(
        client.table("organization_google_credentials")
        .select("google_email")
        .eq("org_id", str(org_id))
        .maybe_single()
    )
    row = getattr(response, "data", None)
    if not row:
        return GoogleStatusResponse(connected=False, google_email=None)
    return GoogleStatusResponse(connected=True, google_email=row.get("google_email"))
