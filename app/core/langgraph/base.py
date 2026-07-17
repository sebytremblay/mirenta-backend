"""Shared infrastructure for per-channel LangGraph subagents.

Concrete channel agents (``SMSAgent``, ``VoiceAgent``) subclass
``BaseChannelAgent`` and get the connection pool, checkpointer, chat/tool-call
node loop, and chat-history plumbing for free — each channel only declares
its ``agent_name``, ``state_cls``, and ``tools``, and overrides ``_chat`` or
``create_graph`` once its behavior actually diverges from the shared default.
"""

import asyncio
from collections.abc import AsyncGenerator
from urllib.parse import quote_plus

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    SystemMessage,
    ToolMessage,
    trim_messages,
)
from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools.base import BaseTool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.errors import GraphInterrupt
from langgraph.graph import (
    END,
    StateGraph,
)
from langgraph.graph.state import (
    Command,
    CompiledStateGraph,
)
from langgraph.types import (
    RetryPolicy,
    StateSnapshot,
)
from psycopg import (
    AsyncConnection,
    sql,
)
from psycopg.rows import (
    DictRow,
    dict_row,
)
from psycopg_pool import AsyncConnectionPool

from app.core.config import (
    Environment,
    settings,
)
from app.core.logging import logger
from app.core.observability import langfuse_callback_handler
from app.core.prompts import load_system_prompt
from app.schemas import GraphState
from app.services.llm import llm_service

PostgresConnPool = AsyncConnectionPool[AsyncConnection[DictRow]]


def _extract_text_content(content: str | list) -> str:
    """Extract plain text from an LLM content value.

    Handles both the simple string format and the structured block list some
    providers return, e.g. ``[{'type': 'reasoning', ...}, {'type': 'text', 'text': '...'}]``.
    """
    if isinstance(content, str):
        return content

    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


class BaseChannelAgent:
    """Shared LangGraph plumbing for a single interaction channel.

    Subclasses set ``agent_name`` (the ``interactions.agent_graph`` label),
    ``state_cls`` (the channel's ``GraphState`` subclass from
    ``app/core/langgraph/state.py``), and ``tools``.
    """

    agent_name: str
    state_cls: type[GraphState]
    tools: list[BaseTool]

    def __init__(self):
        """Bind this channel's tools to the shared LLM service."""
        self.llm_service = llm_service
        self.llm_service.bind_tools(self.tools)
        self.tools_by_name = {tool.name: tool for tool in self.tools}
        self._connection_pool: PostgresConnPool | None = None
        self._graph: CompiledStateGraph | None = None
        logger.info(
            "channel_agent_initialized",
            agent_name=self.agent_name,
            model=settings.DEFAULT_LLM_MODEL,
            environment=settings.ENVIRONMENT.value,
        )

    async def _get_connection_pool(self) -> PostgresConnPool | None:
        """Get a PostgreSQL connection pool using environment-specific settings.

        Returns:
            AsyncConnectionPool or None when the pool fails to initialise in
            production (the app keeps running in a degraded mode).
        """
        if self._connection_pool is None:
            try:
                max_size = settings.POSTGRES_POOL_SIZE
                connection_url = (
                    "postgresql://"
                    f"{quote_plus(settings.SUPABASE_DB_USER)}:{quote_plus(settings.SUPABASE_DB_PASSWORD)}"
                    f"@{settings.SUPABASE_DB_HOST}:{settings.SUPABASE_DB_PORT}/{settings.SUPABASE_DB_NAME}"
                )
                self._connection_pool = AsyncConnectionPool(
                    connection_url,
                    open=False,
                    max_size=max_size,
                    kwargs={
                        "autocommit": True,
                        "connect_timeout": 5,
                        "prepare_threshold": None,
                        "row_factory": dict_row,
                    },
                )
                await self._connection_pool.open()
                logger.info(
                    "connection_pool_created",
                    agent_name=self.agent_name,
                    max_size=max_size,
                    environment=settings.ENVIRONMENT.value,
                )
            except Exception as e:
                logger.error(
                    "connection_pool_creation_failed",
                    agent_name=self.agent_name,
                    error=str(e),
                    environment=settings.ENVIRONMENT.value,
                )
                if settings.ENVIRONMENT == Environment.PRODUCTION:
                    logger.warning("continuing_without_connection_pool", agent_name=self.agent_name)
                    return None
                raise e
        return self._connection_pool

    def _prepare_messages(
        self,
        messages: list[BaseMessage],
        system_prompt: str,
    ) -> list[BaseMessage]:
        """Trim history to the model's token budget and prepend the system prompt.

        Args:
            messages: The conversation so far.
            system_prompt: The base system prompt.
        """
        current_llm = self.llm_service.get_llm()
        trimmed = trim_messages(
            messages,
            strategy="last",
            token_counter=current_llm,
            max_tokens=settings.MAX_TOKENS,
            start_on="human",
            include_system=False,
            allow_partial=False,
        )
        return [SystemMessage(content=system_prompt)] + trimmed

    def _normalize_response(self, response: BaseMessage) -> BaseMessage:
        """Normalise a raw LLM response so ``content`` is always a plain string."""
        if isinstance(response.content, list):
            response.content = _extract_text_content(response.content)
        return response

    async def _chat(self, state: GraphState, config: RunnableConfig) -> Command:
        """Build the system prompt, call the LLM, and route on tool calls.

        Args:
            state: The current state of the conversation.
            config: The runnable configuration for this invocation.

        Returns:
            Command: Command object with updated state and next node to execute.
        """
        thread_id = config.get("configurable", {}).get("thread_id")
        system_prompt = load_system_prompt()
        messages = self._prepare_messages(state.messages, system_prompt)

        try:
            response_message = await self.llm_service.call(messages)
            response_message = self._normalize_response(response_message)

            logger.info(
                "llm_response_generated",
                agent_name=self.agent_name,
                session_id=thread_id,
                environment=settings.ENVIRONMENT.value,
            )

            if isinstance(response_message, AIMessage) and response_message.tool_calls:
                goto = "tool_call"
            else:
                goto = END

            return Command(update={"messages": [response_message]}, goto=goto)
        except Exception as e:
            logger.exception(
                "llm_call_failed",
                agent_name=self.agent_name,
                session_id=thread_id,
                error=str(e),
            )
            raise Exception(f"{self.agent_name} failed to get llm response: {str(e)}")

    async def _tool_call(self, state: GraphState) -> Command:
        """Execute all tool calls from the last message concurrently.

        Args:
            state: The current agent state containing messages and tool calls.

        Returns:
            Command: Updated messages, routing back to the ``chat`` node.
        """
        tool_calls = state.messages[-1].tool_calls

        async def _execute_tool(tool_call: dict) -> ToolMessage:
            tool_result = await self.tools_by_name[tool_call["name"]].ainvoke(tool_call["args"])
            return ToolMessage(
                content=tool_result,
                name=tool_call["name"],
                tool_call_id=tool_call["id"],
            )

        if len(tool_calls) == 1:
            outputs = [await _execute_tool(tool_calls[0])]
        else:
            outputs = list(await asyncio.gather(*[_execute_tool(tc) for tc in tool_calls]))

        return Command(update={"messages": outputs}, goto="chat")

    async def _build_checkpointer(self) -> AsyncPostgresSaver | None:
        """Get a ready-to-use checkpointer, or ``None`` in a degraded production pool."""
        connection_pool = await self._get_connection_pool()
        if connection_pool:
            checkpointer = AsyncPostgresSaver(connection_pool)
            await checkpointer.setup()
            return checkpointer
        if settings.ENVIRONMENT != Environment.PRODUCTION:
            raise Exception("Connection pool initialization failed")
        return None

    async def create_graph(self) -> CompiledStateGraph | None:
        """Create and compile the chat/tool-call graph for this channel.

        Returns:
            Optional[CompiledStateGraph]: The configured LangGraph instance or None if init fails.
        """
        if self._graph is None:
            try:
                graph_builder = StateGraph(self.state_cls)
                graph_builder.add_node("chat", self._chat, destinations=("tool_call", END))
                graph_builder.add_node(
                    "tool_call",
                    self._tool_call,
                    destinations=("chat",),
                    retry_policy=RetryPolicy(max_attempts=3),
                )
                graph_builder.set_entry_point("chat")
                graph_builder.set_finish_point("chat")

                checkpointer = await self._build_checkpointer()

                self._graph = graph_builder.compile(
                    checkpointer=checkpointer,
                    name=f"{settings.PROJECT_NAME} {self.agent_name} ({settings.ENVIRONMENT.value})",
                )

                logger.info(
                    "graph_created",
                    agent_name=self.agent_name,
                    environment=settings.ENVIRONMENT.value,
                    has_checkpointer=checkpointer is not None,
                )
            except Exception as e:
                logger.error(
                    "graph_creation_failed",
                    agent_name=self.agent_name,
                    error=str(e),
                    environment=settings.ENVIRONMENT.value,
                )
                if settings.ENVIRONMENT == Environment.PRODUCTION:
                    logger.warning("continuing_without_graph", agent_name=self.agent_name)
                    return None
                raise e

        return self._graph

    async def _get_graph(self) -> CompiledStateGraph:
        """Return the compiled graph, creating it on first access.

        Raises:
            RuntimeError: When ``create_graph()`` swallowed an init failure
                (production-only path) and returned ``None``. Callers can
                rely on the return being non-``None``.
        """
        if self._graph is None:
            self._graph = await self.create_graph()
        if self._graph is None:
            raise RuntimeError(f"{self.agent_name} graph initialization failed")
        return self._graph

    async def get_response(
        self,
        messages: list[BaseMessage],
        session_id: str,
        user_id: str | None = None,
        metadata: dict | None = None,
    ) -> list[BaseMessage]:
        """Run the graph to completion and return the messages produced by this turn.

        Args:
            messages: The new messages to append to the thread.
            session_id: The session/thread ID for checkpointing.
            user_id: The user this conversation belongs to, if known.
            metadata: Channel-specific context (persona, contact facts, ...)
                forwarded to ``_chat`` via the run config.

        Returns:
            list[BaseMessage]: The response messages from this run.
        """
        graph = await self._get_graph()
        callbacks: list[BaseCallbackHandler] = [langfuse_callback_handler] if settings.LANGFUSE_TRACING_ENABLED else []
        config: RunnableConfig = {
            "configurable": {"thread_id": session_id},
            "callbacks": callbacks,
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "environment": settings.ENVIRONMENT.value,
                "debug": settings.DEBUG,
                **(metadata or {}),
            },
        }

        try:
            state = await graph.aget_state(config)

            if state.next:
                logger.info(
                    "resuming_interrupted_graph",
                    agent_name=self.agent_name,
                    session_id=session_id,
                    next_nodes=state.next,
                )
                response = await graph.ainvoke(Command(resume=messages[-1].content), config=config)
            else:
                response = await graph.ainvoke(input={"messages": messages}, config=config)

            state = await graph.aget_state(config)
            if state.next:
                interrupt_value = state.tasks[0].interrupts[0].value if state.tasks else "Waiting for input."
                logger.info(
                    "graph_interrupted",
                    agent_name=self.agent_name,
                    session_id=session_id,
                    interrupt_value=str(interrupt_value),
                )
                return [AIMessage(content=str(interrupt_value))]

            return response["messages"]
        except GraphInterrupt:
            state = await graph.aget_state(config)
            interrupt_value = state.tasks[0].interrupts[0].value if state.tasks else "Waiting for input."
            logger.info(
                "graph_interrupted",
                agent_name=self.agent_name,
                session_id=session_id,
                interrupt_value=str(interrupt_value),
            )
            return [AIMessage(content=str(interrupt_value))]
        except Exception as e:
            logger.exception("get_response_failed", agent_name=self.agent_name, session_id=session_id, error=str(e))
            raise

    async def get_stream_response(
        self,
        messages: list[BaseMessage],
        session_id: str,
        user_id: str | None = None,
        metadata: dict | None = None,
    ) -> AsyncGenerator[str]:
        """Stream response tokens from the LLM for this channel's graph.

        Args:
            messages: The new messages to append to the thread.
            session_id: The session/thread ID for checkpointing.
            user_id: The user this conversation belongs to, if known.
            metadata: Channel-specific context forwarded to ``_chat``.

        Yields:
            str: Tokens of the LLM response.
        """
        callbacks: list[BaseCallbackHandler] = [langfuse_callback_handler] if settings.LANGFUSE_TRACING_ENABLED else []
        config: RunnableConfig = {
            "configurable": {"thread_id": session_id},
            "callbacks": callbacks,
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "environment": settings.ENVIRONMENT.value,
                "debug": settings.DEBUG,
                **(metadata or {}),
            },
        }
        graph = await self._get_graph()

        try:
            state = await graph.aget_state(config)

            if state.next:
                logger.info("resuming_interrupted_graph_stream", agent_name=self.agent_name, session_id=session_id)
                graph_input = Command(resume=messages[-1].content)
            else:
                graph_input = {"messages": messages}

            async for token, _ in graph.astream(graph_input, config, stream_mode="messages"):
                if not isinstance(token, (AIMessage, AIMessageChunk)):
                    continue

                text = _extract_text_content(token.content)
                if text:
                    yield text

            state = await graph.aget_state(config)
            if state.next:
                interrupt_value = state.tasks[0].interrupts[0].value if state.tasks else "Waiting for input."
                logger.info("graph_interrupted_stream", agent_name=self.agent_name, session_id=session_id)
                yield str(interrupt_value)
        except GraphInterrupt:
            state = await graph.aget_state(config)
            interrupt_value = state.tasks[0].interrupts[0].value if state.tasks else "Waiting for input."
            logger.info("graph_interrupted_stream", agent_name=self.agent_name, session_id=session_id)
            yield str(interrupt_value)
        except Exception as stream_error:
            logger.exception(
                "stream_processing_failed",
                agent_name=self.agent_name,
                session_id=session_id,
                error=str(stream_error),
            )
            raise stream_error

    async def get_chat_history(self, session_id: str) -> list[BaseMessage]:
        """Get the raw checkpointed message history for a given thread ID."""
        graph = await self._get_graph()
        config: RunnableConfig = {"configurable": {"thread_id": session_id}}
        state: StateSnapshot = await graph.aget_state(config=config)
        return state.values["messages"] if state.values else []

    async def clear_chat_history(self, session_id: str) -> None:
        """Clear all checkpointed state for a given thread ID.

        Args:
            session_id: The ID of the session to clear history for.

        Raises:
            Exception: If there's an error clearing the chat history.
        """
        try:
            conn_pool = await self._get_connection_pool()
            if conn_pool is None:
                raise RuntimeError("connection pool unavailable; cannot clear chat history")

            async with conn_pool.connection() as conn:
                async with conn.pipeline():
                    for table in settings.CHECKPOINT_TABLES:
                        await conn.execute(
                            sql.SQL("DELETE FROM {} WHERE thread_id = %s").format(sql.Identifier(table)),
                            (session_id,),
                        )
                logger.info(
                    "checkpoint_tables_cleared_for_session",
                    agent_name=self.agent_name,
                    tables=settings.CHECKPOINT_TABLES,
                    session_id=session_id,
                )
        except Exception as e:
            logger.error(
                "clear_chat_history_operation_failed",
                agent_name=self.agent_name,
                session_id=session_id,
                error=str(e),
            )
            raise
