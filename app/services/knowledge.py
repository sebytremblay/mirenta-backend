"""Load active knowledge rows for SMS grounding."""

from uuid import UUID

from app.core.logging import logger
from app.schemas.knowledge import Knowledge
from app.services.clients.supabase_client import execute_query, get_service_role_client

# Hard cap so a large KB cannot blow the SMS compose prompt.
MAX_KNOWLEDGE_ENTRIES = 40


def format_knowledge_for_prompt(entries: list[Knowledge]) -> str:
    """Render knowledge entries as a compact block for the compose system prompt."""
    if not entries:
        return ""
    lines = ["Organization knowledge (use only these facts; do not invent details):"]
    for entry in entries:
        lines.append(f"- [{entry.kind}] {entry.title}: {entry.content}")
    return "\n".join(lines)


async def fetch_active_knowledge(org_id: UUID | str) -> list[Knowledge]:
    """Fetch active knowledge rows for an org, newest first, capped for prompt size."""
    client = await get_service_role_client()
    response = await execute_query(
        client.table("knowledge")
        .select("*")
        .eq("org_id", str(org_id))
        .eq("is_active", True)
        .order("kind")
        .order("created_at", desc=True)
        .limit(MAX_KNOWLEDGE_ENTRIES)
    )
    entries = [Knowledge(**row) for row in (response.data or [])]
    logger.info("knowledge_loaded", org_id=str(org_id), count=len(entries))
    return entries
