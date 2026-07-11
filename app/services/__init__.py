"""Application services: external clients, domain helpers, LLM, and runtimes.

Layout:
- ``clients/`` — thin wrappers around external SDKs (Supabase, Twilio, Temporal, Deepgram)
- ``llm/`` — stateful LLM service (registry, retries, fallback)
- ``runtimes/`` — long-lived sessions outside Temporal (e.g. live voice)
- top-level modules — domain helpers as plain async functions (knowledge, SMS fast-path)
"""

from app.services.llm import (
    LLMRegistry,
    llm_service,
)

__all__ = ["LLMRegistry", "llm_service"]
