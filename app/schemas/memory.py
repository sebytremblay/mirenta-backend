"""This file contains the contact-memory schema for the application.

Covers the Supabase `contact_memory` table and the `match_contact_memory`
RPC used for semantic recall (see `supabase/migrations/0007_memory.sql`).
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse

MemoryKind = Literal["summary", "fact", "transcript_chunk", "preference"]


class ContactMemory(BaseResponse):
    """An embedded chunk of contact-level memory for semantic recall.

    Rolling summaries also live on `contact_state.memory_summary`; this
    table stores the embedded chunks searched by `memory/store.py`.

    Attributes:
        id: Memory record ID.
        org_id: The organization this memory belongs to.
        contact_id: The contact this memory is about.
        interaction_id: The interaction this memory was extracted from, for provenance.
        kind: What kind of memory this is.
        content: The memory text.
        embedding: The embedding vector (text-embedding-3-small, 1536 dims).
        metadata: Arbitrary structured metadata.
        superseded_by: The memory record that soft-invalidates this one, if any.
        created_at: When the memory was written.
    """

    id: UUID = Field(..., description="Memory record ID")
    org_id: UUID = Field(..., description="The organization this memory belongs to")
    contact_id: UUID = Field(..., description="The contact this memory is about")
    interaction_id: UUID | None = Field(
        default=None, description="The interaction this memory was extracted from, for provenance"
    )
    kind: MemoryKind = Field(..., description="What kind of memory this is")
    content: str = Field(..., description="The memory text")
    embedding: list[float] | None = Field(
        default=None, description="The embedding vector (text-embedding-3-small, 1536 dims)"
    )
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary structured metadata")
    superseded_by: UUID | None = Field(
        default=None, description="The memory record that soft-invalidates this one, if any"
    )
    created_at: datetime = Field(..., description="When the memory was written")


class ContactMemoryMatch(BaseResponse):
    """A row returned by the `match_contact_memory` RPC (semantic search).

    Attributes:
        id: Memory record ID.
        kind: What kind of memory this is.
        content: The memory text.
        metadata: Arbitrary structured metadata.
        similarity: Cosine similarity to the query embedding, in [0, 1].
        created_at: When the memory was written.
    """

    id: UUID = Field(..., description="Memory record ID")
    kind: MemoryKind = Field(..., description="What kind of memory this is")
    content: str = Field(..., description="The memory text")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary structured metadata")
    similarity: float = Field(..., description="Cosine similarity to the query embedding, in [0, 1]")
    created_at: datetime = Field(..., description="When the memory was written")
