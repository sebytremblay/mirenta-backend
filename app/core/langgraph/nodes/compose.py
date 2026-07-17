"""compose node — the LLM call that drafts the outbound message.

Reusable across compose -> guardrail retry cycles: on retry,
`state.guardrail_feedback` is folded into the prompt so the model can
correct the specific violation instead of blindly regenerating.
"""

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import StructuredTool
from langgraph.graph.state import Command

from app.agent_tools import ToolContext, build_langchain_tools, get_tools
from app.core.langgraph.state import SMSState
from app.core.logging import logger
from app.core.prompts import load_system_prompt
from app.services.llm import llm_service

DEFAULT_CHANNEL_CONSTRAINTS = {"max_length": 320}

# Bound so a misbehaving model can't loop on tool calls forever inside one turn.
MAX_TOOL_ITERATIONS = 3


def _live_sms_tools():
    """Registered SMS tools, excluding the tagged examples.

    Examples are reference implementations only; they must never bind into a
    live channel. Today this returns an empty list (only example tools exist),
    which keeps the tool loop below inert and SMS behavior unchanged until a
    real tool is registered.
    """
    return [t for t in get_tools(channel="sms") if "example" not in t.tags]


def _tool_context(config: RunnableConfig) -> ToolContext | None:
    """Build a ToolContext from run metadata, or None when identity is absent.

    A console/playground invocation without org/contact ids gets no tools —
    correlation ids are required for a tool to act on a specific contact.
    """
    metadata = config.get("metadata", {})
    org_id = metadata.get("org_id")
    contact_id = metadata.get("contact_id")
    if not (org_id and contact_id):
        return None
    return ToolContext(
        org_id=str(org_id),
        contact_id=str(contact_id),
        channel="sms",
        thread_id=config.get("configurable", {}).get("thread_id"),
        signal_id=metadata.get("signal_id"),
    )


async def _resolve_tool_calls(
    messages: list[BaseMessage],
    tools_by_name: dict[str, StructuredTool],
    response: AIMessage,
) -> None:
    """Append the assistant turn and one ToolMessage per requested tool call."""
    messages.append(response)
    for call in response.tool_calls:
        tool = tools_by_name.get(call["name"])
        if tool is None:
            result = f"error: unknown tool '{call['name']}'"
            logger.warning("sms_tool_unknown", tool=call["name"])
        else:
            result = await tool.ainvoke(call["args"])
        messages.append(ToolMessage(content=result, name=call["name"], tool_call_id=call["id"]))

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

    messages: list[BaseMessage] = [SystemMessage(content=system_prompt), SystemMessage(content=instructions)]
    if knowledge:
        messages.append(SystemMessage(content=knowledge))
    messages.extend(state.messages)

    # Bind live SMS tools (context injected out-of-band, never model-supplied)
    # only when both a tool exists and the run carries contact identity. With no
    # live tools this collapses to the original single, tool-free llm call.
    context = _tool_context(config)
    live_tools = _live_sms_tools() if context is not None else []

    if not live_tools:
        response = await llm_service.call(messages)
    else:
        bound = build_langchain_tools(live_tools, context)  # type: ignore[arg-type]
        tools_by_name = {tool.name: tool for tool in bound}
        response = await llm_service.call(messages, tools=bound)
        iterations = 0
        while (
            isinstance(response, AIMessage)
            and response.tool_calls
            and iterations < MAX_TOOL_ITERATIONS
        ):
            await _resolve_tool_calls(messages, tools_by_name, response)
            response = await llm_service.call(messages, tools=bound)
            iterations += 1
        if isinstance(response, AIMessage) and response.tool_calls:
            logger.warning("sms_tool_loop_truncated", iterations=iterations)

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
