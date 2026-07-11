"""compose node — the LLM call that drafts the outbound message.

Reusable across compose -> guardrail retry cycles: on retry,
`state.guardrail_feedback` is folded into the prompt so the model can
correct the specific violation instead of blindly regenerating.
"""

from langchain_core.messages import SystemMessage
from langchain_core.runnables.config import RunnableConfig
from langgraph.graph.state import Command

from app.core.langgraph.state import SMSState
from app.core.logging import logger
from app.core.prompts import load_system_prompt
from app.services.llm import llm_service

DEFAULT_CHANNEL_CONSTRAINTS = {"max_length": 320}

GOAL_INSTRUCTIONS = {
    "reply_to_inbound_sms": (
        "Reply to the contact's latest message. If they ask about booking, scheduling, "
        "rescheduling, or appointments, use organization knowledge to help them."
    ),
    "follow_up_no_response": (
        "The contact has not replied for a few days. Send a brief, polite follow-up. "
        "Offer to help with questions or booking if relevant; do not pressure them."
    ),
}


async def compose(state: SMSState, config: RunnableConfig) -> Command:
    """Draft the outbound SMS reply, given the task goal and channel constraints.

    `goal`/`channel_constraints`/`knowledge` come from
    `get_response(..., metadata=...)` on the first pass and are persisted onto
    state so later compose->guardrail loop iterations don't need to re-read config.
    """
    metadata = config.get("metadata", {})
    goal = state.goal or metadata.get("task_goal") or ""
    channel_constraints = (
        state.channel_constraints or metadata.get("channel_constraints") or DEFAULT_CHANNEL_CONSTRAINTS
    )
    knowledge = state.knowledge or metadata.get("knowledge") or ""

    system_prompt = load_system_prompt()
    goal_detail = GOAL_INSTRUCTIONS.get(goal, "")
    instructions = f"Goal for this message: {goal}."
    if goal_detail:
        instructions += f" {goal_detail}"
    instructions += f" Channel constraints: {channel_constraints}."
    if state.guardrail_feedback:
        instructions += f" Your previous draft was rejected: {state.guardrail_feedback}. Regenerate, correcting this."

    messages = [SystemMessage(content=system_prompt), SystemMessage(content=instructions)]
    if knowledge:
        messages.append(SystemMessage(content=knowledge))
    messages.extend(state.messages)

    response = await llm_service.call(messages)
    draft = response.content if isinstance(response.content, str) else str(response.content)

    logger.info("sms_draft_composed", guardrail_attempts=state.guardrail_attempts, draft_length=len(draft))
    return Command(
        update={
            "draft": draft,
            "goal": goal,
            "channel_constraints": channel_constraints,
            "knowledge": knowledge,
        },
        goto="output_guardrails",
    )
