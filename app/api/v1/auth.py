"""Authentication for the API.

User identity is established entirely by Supabase Auth — clients sign up and
log in directly against Supabase, and this backend only verifies the
resulting Supabase JWT.
"""

from fastapi import (
    Depends,
    HTTPException,
)
from fastapi.security import (
    HTTPAuthorizationCredentials,
    HTTPBearer,
)

from app.core.logging import (
    bind_context,
    logger,
)
from app.schemas.auth import SupabaseUser
from app.utils.auth import verify_supabase_token
from app.utils.sanitization import sanitize_string

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> SupabaseUser:
    """Get the current authenticated user from a verified Supabase JWT.

    Args:
        credentials: The HTTP authorization credentials containing the Supabase access token.

    Returns:
        SupabaseUser: The identity extracted from the verified Supabase token.

    Raises:
        HTTPException: If the token is invalid or missing.
    """
    try:
        token = sanitize_string(credentials.credentials)

        payload = await verify_supabase_token(token)
        if payload is None:
            logger.error("invalid_supabase_token", token_part=token[:10] + "...")
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user_id = payload["sub"]
        email = payload.get("email")
        display_name = (payload.get("user_metadata") or {}).get("full_name")

        # Bind user_id to logging context for all subsequent logs in this request
        bind_context(user_id=user_id)

        return SupabaseUser(id=user_id, email=email, display_name=display_name, access_token=token)
    except ValueError as ve:
        logger.exception("supabase_token_validation_failed", error=str(ve))
        raise HTTPException(
            status_code=422,
            detail="Invalid token format",
            headers={"WWW-Authenticate": "Bearer"},
        )
