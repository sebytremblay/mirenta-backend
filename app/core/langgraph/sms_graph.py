"""SMS channel subagent — texts on behalf of the organization, one turn at a time.

Overrides `create_graph()` with a compose -> output_guardrails loop instead
of the shared chat/tool-call graph — see `docs/architecture.md` §5 and
`base.py`'s docstring on per-channel divergence via override.
"""

from typing import Optional, override

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import RetryPolicy

from app.core.langgraph.base import BaseChannelAgent
from app.core.langgraph.nodes.compose import compose
from app.core.langgraph.nodes.output_guardrails import output_guardrails
from app.core.langgraph.state import SMSState
from app.core.langgraph.tools import tools
from app.core.config import settings
from app.core.logging import logger


class SMSAgent(BaseChannelAgent):
    """Runs the compose/output-guardrails loop over the SMS channel."""

    agent_name = "sms_agent"
    state_cls = SMSState
    tools = tools

    @override
    async def create_graph(self) -> Optional[CompiledStateGraph]:
        """Build the compose <-> output_guardrails graph (see module docstring)."""
        if self._graph is None:
            try:
                graph_builder = StateGraph(self.state_cls)
                graph_builder.add_node("compose", compose, destinations=("output_guardrails",))
                graph_builder.add_node(
                    "output_guardrails",
                    output_guardrails,
                    destinations=("compose", END),
                    retry_policy=RetryPolicy(max_attempts=3),
                )
                graph_builder.set_entry_point("compose")
                graph_builder.set_finish_point("compose")

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
                raise

        return self._graph


sms_agent = SMSAgent()
