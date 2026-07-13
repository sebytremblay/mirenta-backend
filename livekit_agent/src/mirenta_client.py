"""HTTP client the LiveKit Cloud agent uses to talk to Mirenta FastAPI."""

from __future__ import annotations

import os
from typing import Any

import httpx

MIRENTA_API_BASE_URL = os.getenv("MIRENTA_API_BASE_URL", "http://localhost:8000").rstrip("/")
MIRENTA_INTERNAL_API_KEY = os.getenv("MIRENTA_INTERNAL_API_KEY", "")
API_PREFIX = os.getenv("API_PREFIX", "/api")


class MirentaVoiceClient:
    """Thin wrapper around Mirenta's internal voice bootstrap/finalize APIs."""

    def __init__(
        self,
        *,
        base_url: str = MIRENTA_API_BASE_URL,
        api_key: str = MIRENTA_INTERNAL_API_KEY,
        api_prefix: str = API_PREFIX,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_prefix = api_prefix.rstrip("/") or "/api"
        self._api_key = api_key
        self._timeout = timeout_seconds

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-Mirenta-Internal-Key": self._api_key,
        }

    def _url(self, path: str) -> str:
        return f"{self._base_url}{self._api_prefix}{path}"

    async def bootstrap(
        self,
        *,
        org_id: str,
        contact_id: str,
        signal_id: str,
        call_sid: str,
        room_name: str | None = None,
    ) -> dict[str, Any]:
        """Fetch persona instructions + knowledge for this call."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                self._url("/internal/voice/bootstrap"),
                headers=self._headers(),
                json={
                    "org_id": org_id,
                    "contact_id": contact_id,
                    "signal_id": signal_id,
                    "call_sid": call_sid,
                    "room_name": room_name,
                },
            )
            self._raise_for_status(response)
            return response.json()

    async def finalize(
        self,
        *,
        org_id: str,
        contact_id: str,
        signal_id: str,
        call_sid: str,
        transcript: list[dict[str, Any]],
        outcome: str | None = None,
        summary: str | None = None,
        room_name: str | None = None,
    ) -> dict[str, Any]:
        """Log the call and re-enter Mirenta's ContactLoopWorkflow."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                self._url("/internal/voice/finalize"),
                headers=self._headers(),
                json={
                    "org_id": org_id,
                    "contact_id": contact_id,
                    "signal_id": signal_id,
                    "call_sid": call_sid,
                    "transcript": transcript,
                    "outcome": outcome,
                    "summary": summary,
                    "room_name": room_name,
                },
            )
            self._raise_for_status(response)
            return response.json()

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        """Raise with response body included so Cloud agent logs are actionable."""
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = (response.text or "").strip()
            if detail:
                raise httpx.HTTPStatusError(
                    f"{exc} body={detail[:500]}",
                    request=exc.request,
                    response=exc.response,
                ) from exc
            raise
