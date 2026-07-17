"""Runs the channel LangGraph subagent for one task.

The sole seam between the deterministic Temporal/decision layer and the
generative LangGraph layer — the only file in `activities/` allowed to
import from `app.core.langgraph` (see AGENTS.md's deterministic-core
invariant and `docs/architecture.md#5--interaction-layer-llm-subagents`).
"""

from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel
from temporalio import activity

from app.core.langgraph.sms_graph import sms_agent
from app.core.logging import logger
from app.schemas.contacts import Contact, ContactState
from app.schemas.tasks import Task
from app.services.knowledge import fetch_active_knowledge, format_knowledge_for_prompt

DEFAULT_SMS_CHANNEL_CONSTRAINTS = {"max_length": 320}

FOLLOW_UP_HUMAN_PROMPT = (
    "[System note: no new inbound message. Draft the scheduled no-response follow-up based on the prior conversation.]"
)


class RunInteractionInput(BaseModel):
    """Arguments to `run_interaction`."""

    task: Task
    contact: Contact
    contact_state: ContactState


class RunInteractionResult(BaseModel):
    """Result of `run_interaction`."""

    reply: str | None
    agent_graph: str
    transcript_turn: list[dict[str, str]]
    guardrail_escalated: bool = False
    guardrail_violations: list[str] = []
    task_goal: str | None = None


@activity.defn
async def run_interaction(input: RunInteractionInput) -> RunInteractionResult:
    """Invokes `sms_agent.get_response(...)` for an `sms`-type task.

    `session_id` is `f"sms:{org_id}:{contact_id}"` — the same scheme
    `app/services/sms_interaction.py` already used, so existing checkpointed
    threads keep working after the cutover to Temporal.
    """
    goal = input.task.payload.get("goal") or "reply_to_inbound_sms"
    body = input.task.payload.get("inbound_body", "")
    if not body and goal == "follow_up_no_response":
        body = FOLLOW_UP_HUMAN_PROMPT

    knowledge_entries = await fetch_active_knowledge(input.task.org_id)
    knowledge = format_knowledge_for_prompt(knowledge_entries)

    thread_id = f"sms:{input.task.org_id}:{input.task.contact_id}"
    response_messages = await sms_agent.get_response(
        [HumanMessage(content=body)],
        session_id=thread_id,
        metadata={
            "org_id": str(input.task.org_id),
            "contact_id": str(input.task.contact_id),
            "task_id": str(input.task.id),
            "task_goal": goal,
            "channel_constraints": DEFAULT_SMS_CHANNEL_CONSTRAINTS,
            "knowledge": knowledge,
            "memory_summary": input.contact_state.memory_summary or "",
        },
    )
    reply_message = next(
        (
            message
            for message in reversed(response_messages)
            if isinstance(message, AIMessage) and isinstance(message.content, str) and message.content
        ),
        None,
    )
    reply: str | None = None
    guardrail_escalated = False
    guardrail_violations: list[str] = []
    if reply_message is not None and isinstance(reply_message.content, str):
        reply = reply_message.content
        guardrail_escalated = bool(reply_message.additional_kwargs.get("guardrail_escalated"))
        guardrail_violations = reply_message.additional_kwargs.get("violations", [])

    transcript_turn = [{"role": "human", "content": body}]
    if reply:
        transcript_turn.append({"role": "ai", "content": reply})

    logger.info(
        "interaction_run_completed",
        task_id=str(input.task.id),
        agent_graph=sms_agent.agent_name,
        has_reply=reply is not None,
        guardrail_escalated=guardrail_escalated,
        knowledge_entries=len(knowledge_entries),
    )
    return RunInteractionResult(
        reply=reply,
        agent_graph=sms_agent.agent_name,
        transcript_turn=transcript_turn,
        guardrail_escalated=guardrail_escalated,
        guardrail_violations=guardrail_violations,
        task_goal=goal,
    )
