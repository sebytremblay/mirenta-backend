"""This file contains the task schema for the application.

Covers the Supabase `tasks` table — scheduled executable events emitted by
the decision engine (see `supabase/migrations/0005_tasks.sql`).
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.base import BaseResponse

TaskType = Literal["call", "sms", "webhook", "api_call"]
TaskStatus = Literal["scheduled", "running", "completed", "failed", "canceled", "skipped_guardrail"]


class Task(BaseResponse):
    """A scheduled executable event emitted by the decision engine.

    Attributes:
        id: Task ID.
        org_id: The organization this task belongs to.
        contact_id: The contact this task targets.
        caused_by_signal_id: The signal that triggered this task, for provenance.
        type: What kind of task this is.
        status: The task's execution status.
        idempotency_key: Deterministic key the decision engine derives, for dedup.
        scheduled_for: When the task is due to run.
        payload: Channel-specific params (template, script goal, url...).
        guardrail_result: Which guardrail checks passed/failed at execution time.
        attempts: How many times execution has been attempted.
        max_attempts: The maximum number of attempts before giving up.
        temporal_workflow_id: The child TaskExecutionWorkflow ID.
        temporal_run_id: The Temporal run ID.
        error: Error detail if the task failed.
        started_at: When execution started.
        completed_at: When execution finished.
        created_at: When the task was created.
        updated_at: When the task was last updated.
    """

    id: UUID = Field(..., description="Task ID")
    org_id: UUID = Field(..., description="The organization this task belongs to")
    contact_id: UUID = Field(..., description="The contact this task targets")
    caused_by_signal_id: UUID | None = Field(
        default=None, description="The signal that triggered this task, for provenance"
    )
    type: TaskType = Field(..., description="What kind of task this is")
    status: TaskStatus = Field(default="scheduled", description="The task's execution status")
    idempotency_key: str = Field(..., description="Deterministic key the decision engine derives, for dedup")
    scheduled_for: datetime = Field(..., description="When the task is due to run")
    payload: dict[str, Any] = Field(default_factory=dict, description="Channel-specific params")
    guardrail_result: dict[str, Any] | None = Field(
        default=None, description="Which guardrail checks passed/failed at execution time"
    )
    attempts: int = Field(default=0, description="How many times execution has been attempted")
    max_attempts: int = Field(default=3, description="The maximum number of attempts before giving up")
    temporal_workflow_id: str | None = Field(default=None, description="The child TaskExecutionWorkflow ID")
    temporal_run_id: str | None = Field(default=None, description="The Temporal run ID")
    error: str | None = Field(default=None, description="Error detail if the task failed")
    started_at: datetime | None = Field(default=None, description="When execution started")
    completed_at: datetime | None = Field(default=None, description="When execution finished")
    created_at: datetime = Field(..., description="When the task was created")
    updated_at: datetime = Field(..., description="When the task was last updated")
