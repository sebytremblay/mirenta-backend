"""Unit tests for knowledge prompt formatting."""

from datetime import datetime, timezone
from uuid import uuid4

from app.schemas.knowledge import Knowledge
from app.services.knowledge import format_knowledge_for_prompt


def test_format_knowledge_for_prompt_empty() -> None:
    assert format_knowledge_for_prompt([]) == ""


def test_format_knowledge_for_prompt_includes_kind_and_content() -> None:
    entry = Knowledge(
        id=uuid4(),
        org_id=uuid4(),
        kind="booking",
        title="How to book",
        content="Text a preferred day and time.",
        metadata={},
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    formatted = format_knowledge_for_prompt([entry])
    assert "Organization knowledge" in formatted
    assert "[booking] How to book" in formatted
    assert "Text a preferred day and time." in formatted
