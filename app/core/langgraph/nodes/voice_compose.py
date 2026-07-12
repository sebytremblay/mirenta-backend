"""voice_compose node — the LLM call that drafts one spoken turn.

Mirrors `compose.py`'s SMS shape (goal/channel_constraints from metadata on
the first pass, `guardrail_feedback` folded in on retry) but tunes the
prompt for spoken output and uses `settings.VOICE_LLM_MODEL`, since a live
call's turn-latency budget is tighter than a scheduled SMS reply.
"""

from langchain_core.messages import SystemMessage
from langchain_core.runnables.config import RunnableConfig
from langgraph.graph.state import Command

from app.core.config import settings
from app.core.langgraph.state import VoiceState
from app.core.logging import logger
from app.core.prompts import load_system_prompt
from app.services.llm import llm_service

DEFAULT_CHANNEL_CONSTRAINTS = {"max_length": 600}

VOICE_STYLE_INSTRUCTIONS = (
    "You are speaking on a live phone call, not texting. Reply in short, "
    "natural spoken sentences (no more than 2-3 sentences per turn). Never "
    "use markdown, bullet lists, or URLs -- everything you say is read "
    "aloud. Spell out anything that needs to sound natural when spoken. "
    "An opening greeting has already been spoken at the start of this call; "
    "do not greet again — respond directly to what the caller just said."
)


async def compose(state: VoiceState, config: RunnableConfig) -> Command:
    """Draft the next spoken turn, given the call goal and channel constraints.

    `goal`/`channel_constraints`/`knowledge` come from `get_response(..., metadata=...)`
    on the first pass and are persisted onto state so later
    compose->guardrail loop iterations don't need to re-read config.
    """
    metadata = config.get("metadata", {})
    goal = state.goal or metadata.get("task_goal") or ""
    channel_constraints = (
        state.channel_constraints or metadata.get("channel_constraints") or DEFAULT_CHANNEL_CONSTRAINTS
    )
    knowledge = state.knowledge or metadata.get("knowledge") or ""

    system_prompt = load_system_prompt()
    instructions = (
        f"{VOICE_STYLE_INSTRUCTIONS} Goal for this call: {goal}. Channel constraints: {channel_constraints}."
    )
    if state.guardrail_feedback:
        instructions += f" Your previous draft was rejected: {state.guardrail_feedback}. Regenerate, correcting this."

    messages = [SystemMessage(content=system_prompt), SystemMessage(content=instructions)]
    if knowledge:
        messages.append(SystemMessage(content=knowledge))
    messages.extend(state.messages)
    response = await llm_service.call(messages, model_name=settings.VOICE_LLM_MODEL)
    draft = response.content if isinstance(response.content, str) else str(response.content)

    logger.info("voice_draft_composed", guardrail_attempts=state.guardrail_attempts, draft_length=len(draft))
    return Command(
        update={
            "draft": draft,
            "goal": goal,
            "channel_constraints": channel_constraints,
            "knowledge": knowledge,
        },
        goto="output_guardrails",
    )
