"""Custom middleware for cross-cutting concerns."""

from typing import (
    Callable,
    override,
)

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.core.logging import clear_context


class LoggingContextMiddleware(BaseHTTPMiddleware):
    """Middleware that isolates structlog context between requests.

    Per-request identifiers (e.g. user_id) are bound directly by the auth
    dependency that establishes them (see `get_current_user` in
    `app/api/routers/auth.py`); this middleware only guarantees that context never
    leaks from one request into the next.
    """

    @override
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Clear logging context before and after each request.

        Args:
            request: The incoming request
            call_next: The next middleware or route handler

        Returns:
            Response: The response from the application
        """
        try:
            clear_context()
            return await call_next(request)
        finally:
            clear_context()
