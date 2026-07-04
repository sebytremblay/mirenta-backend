"""This file contains the authentication utilities for the application."""

import re
from typing import Any, Optional

from jose import (
    JWTError,
    jwt,
)

from app.core.config import settings
from app.core.logging import logger

JWT_FORMAT_PATTERN = re.compile(r"^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$")


def verify_supabase_token(token: str) -> Optional[dict[str, Any]]:
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
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        user_id: str | None = payload.get("sub")
        if user_id is None:
            logger.warning("supabase_token_missing_subject")
            return None

        logger.info("supabase_token_verified", user_id=user_id)
        return payload

    except JWTError as e:
        logger.error("supabase_token_verification_failed", error=str(e))
        return None
