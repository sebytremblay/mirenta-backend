"""This file contains the authentication utilities for the application."""

import asyncio
import re
import time
from typing import Any, Optional

import httpx
from jose import (
    JWTError,
    jwt,
)
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.logging import logger

JWT_FORMAT_PATTERN = re.compile(r"^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$")
JWKS_CACHE_TTL_SECONDS = 3600

_jwks_cache: dict[str, Any] = {}
_jwks_cached_at: float = 0.0
_jwks_lock = asyncio.Lock()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    reraise=True,
)
async def _fetch_jwks() -> dict[str, Any]:
    """Fetch Supabase's JSON Web Key Set, retrying on transient network errors.

    Returns:
        dict[str, Any]: The JWKS document (a `keys` list of public signing keys).
    """
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(settings.SUPABASE_JWKS_URL)
        response.raise_for_status()
        return response.json()


async def _get_signing_key(kid: str) -> Optional[dict[str, Any]]:
    """Get the JWK matching `kid`, refreshing the cache if needed.

    Args:
        kid: The key ID from the token's header.

    Returns:
        Optional[dict[str, Any]]: The matching JWK, or None if no key with
            that ID is present even after a cache refresh (rotation).
    """
    global _jwks_cache, _jwks_cached_at

    now = time.monotonic()
    if not _jwks_cache or now - _jwks_cached_at > JWKS_CACHE_TTL_SECONDS:
        async with _jwks_lock:
            now = time.monotonic()
            if not _jwks_cache or now - _jwks_cached_at > JWKS_CACHE_TTL_SECONDS:
                _jwks_cache = await _fetch_jwks()
                _jwks_cached_at = now

    for key in _jwks_cache.get("keys", []):
        if key.get("kid") == kid:
            return key

    # Key not found — the set may have rotated since our last fetch. Refresh
    # once and retry the lookup before giving up.
    async with _jwks_lock:
        _jwks_cache = await _fetch_jwks()
        _jwks_cached_at = time.monotonic()

    return next((key for key in _jwks_cache.get("keys", []) if key.get("kid") == kid), None)


async def verify_supabase_token(token: str) -> Optional[dict[str, Any]]:
    """Verify a Supabase-issued user JWT and return its claims.

    Args:
        token: The Supabase access token to verify.

    Returns:
        Optional[dict[str, Any]]: The decoded claims (`sub`, `email`,
            `user_metadata`, `role`, ...) if the token is valid, None otherwise.

    Raises:
        ValueError: If the token format is invalid.
    """
    if not token or not isinstance(token, str):
        logger.warning("supabase_token_invalid_format")
        raise ValueError("Token must be a non-empty string")

    if not JWT_FORMAT_PATTERN.match(token):
        logger.warning("supabase_token_suspicious_format")
        raise ValueError("Token format is invalid - expected JWT format")

    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if kid is None:
            logger.warning("supabase_token_missing_kid")
            return None

        signing_key = await _get_signing_key(kid)
        if signing_key is None:
            logger.warning("supabase_token_unknown_kid", kid=kid)
            return None

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=[signing_key.get("alg", "ES256")],
            audience="authenticated",
        )
        user_id: str | None = payload.get("sub")
        if user_id is None:
            logger.warning("supabase_token_missing_subject")
            return None

        logger.info("supabase_token_verified", user_id=user_id)
        return payload

    except JWTError as e:
        logger.exception("supabase_token_verification_failed", error=str(e))
        return None
