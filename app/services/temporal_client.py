"""Temporal client factory — durable workflow/task scheduling connection."""

import asyncio

from temporalio.client import Client
from temporalio.contrib.pydantic import pydantic_data_converter
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.core.logging import logger

_client: Client | None = None
_client_lock = asyncio.Lock()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception_type((ConnectionError, TimeoutError)),
    reraise=True,
)
async def _connect() -> Client:
    return await Client.connect(
        settings.TEMPORAL_ADDRESS,
        namespace=settings.TEMPORAL_NAMESPACE,
        tls=settings.TEMPORAL_TLS,
        api_key=settings.TEMPORAL_API_KEY if settings.TEMPORAL_TLS else None,
        data_converter=pydantic_data_converter,
    )


async def get_temporal_client() -> Client:
    """Get the cached Temporal client, connecting on first use.

    Uses `pydantic_data_converter` so workflows/activities can accept and
    return the app's existing Pydantic schemas (`Signal`, `Task`, ...)
    directly, instead of hand-rolled dataclasses. Shared by the FastAPI
    process (to signal-with-start a `ContactLoopWorkflow`) and by
    `worker/main.py` (to run the `Worker`).
    """
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = await _connect()
                logger.info(
                    "temporal_client_connected",
                    address=settings.TEMPORAL_ADDRESS,
                    namespace=settings.TEMPORAL_NAMESPACE,
                    tls=settings.TEMPORAL_TLS,
                )
    return _client
