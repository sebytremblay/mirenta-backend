"""Pure helpers for SIP/call context — kept free of LiveKit Agents imports for unit tests."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("mirenta-voice")

# Participant attribute keys produced by trunk headers_to_attributes mapping.
ATTR_ORG_ID = "mirenta.org_id"
ATTR_CONTACT_ID = "mirenta.contact_id"
ATTR_SIGNAL_ID = "mirenta.signal_id"
ATTR_CALL_SID = "mirenta.call_sid"


def parse_metadata(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("voice_metadata_invalid raw=%r", raw)
        return {}
    return data if isinstance(data, dict) else {}


def attr(attrs: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = (attrs.get(key) or "").strip()
        if value:
            return value
    return ""


def call_context_from_participant_attrs(attrs: dict[str, str]) -> dict[str, str]:
    """Resolve Mirenta ids from SIP participant attributes or room metadata."""
    return {
        "org_id": attr(attrs, ATTR_ORG_ID, "sip.h.x-mirenta-org-id", "x-mirenta-org-id"),
        "contact_id": attr(attrs, ATTR_CONTACT_ID, "sip.h.x-mirenta-contact-id", "x-mirenta-contact-id"),
        "signal_id": attr(attrs, ATTR_SIGNAL_ID, "sip.h.x-mirenta-signal-id", "x-mirenta-signal-id"),
        "call_sid": attr(attrs, ATTR_CALL_SID, "sip.h.x-mirenta-call-sid", "x-mirenta-call-sid"),
    }


def call_context_from_metadata(
    job_metadata: str | None,
    room_metadata: str | None,
) -> dict[str, str]:
    """Fallback: job/room metadata (explicit API dispatch / older flows)."""
    job_meta = parse_metadata(job_metadata)
    room_meta = parse_metadata(room_metadata)
    merged = {**room_meta, **job_meta}
    return {
        "org_id": str(merged.get("org_id") or ""),
        "contact_id": str(merged.get("contact_id") or ""),
        "signal_id": str(merged.get("signal_id") or ""),
        "call_sid": str(merged.get("call_sid") or ""),
    }


def merge_call_context(
    participant_attrs: dict[str, str],
    job_metadata: str | None,
    room_metadata: str | None,
) -> dict[str, str]:
    """Prefer SIP participant attrs; fill gaps from job/room metadata."""
    context = call_context_from_participant_attrs(participant_attrs)
    if all(context.values()):
        return context
    fallback = call_context_from_metadata(job_metadata, room_metadata)
    return {key: context[key] or fallback[key] for key in context}


def infer_outcome(transcript: list[dict[str, str]]) -> str:
    if any(row.get("role") == "ai" for row in transcript):
        return "progressed"
    return "no_answer"
