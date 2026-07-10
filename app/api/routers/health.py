"""Versioned health-check endpoint for the API.

The unversioned `/health` (see `app/main.py`) does a real DB round-trip and
is what load balancers/uptime checks should hit; this one is a cheap
liveness check under the API prefix for API-client tooling.
"""

from fastapi import APIRouter, Request

from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger

router = APIRouter()


@router.get("/health")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["health"][0])
async def health_check(request: Request):
    """Liveness check endpoint.

    Args:
        request: The FastAPI request object for rate limiting.

    Returns:
        dict: Health status information.
    """
    logger.info("health_check_called")
    return {"status": "healthy", "version": settings.VERSION}
