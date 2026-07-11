"""Schemas for the per-org knowledge base (`knowledge` table)."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse

KnowledgeKind = Literal["general", "booking", "hours", "services", "faq", "policy"]


class Knowledge(BaseResponse):
    """One knowledge entry that grounds outreach replies for an organization."""

    id: UUID = Field(..., description="Knowledge entry ID")
    org_id: UUID = Field(..., description="Owning organization")
    kind: KnowledgeKind = Field(default="general", description="Category used for prompt grounding")
    title: str = Field(..., description="Short label shown in agent context")
    content: str = Field(..., description="Facts the agent may use when drafting replies")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Optional structured extras")
    is_active: bool = Field(default=True, description="Inactive rows are excluded from agent grounding")
    created_at: datetime = Field(..., description="When the entry was created")
    updated_at: datetime = Field(..., description="When the entry was last updated")
