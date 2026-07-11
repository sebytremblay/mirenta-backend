"""Voice channel subagent — converses on behalf of the clinic during a live call.

Overrides `create_graph()` with a compose -> output_guardrails loop, mirroring
`sms_graph.py`'s shape (see `docs/architecture.md` §5 and `base.py`'s
docstring on per-channel divergence via override). Invoked one turn at a
time from `app/services/voice_runtime.py`'s `VoiceCallSession`, not from a
Temporal activity -- see `docs/architecture.md`'s voice-runtime section for
why a live call can't be a Temporal activity the way an SMS task is.
"""

from typing import Optional, override

from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import RetryPolicy

from app.core.config import settings
from app.core.langgraph.base import BaseChannelAgent
from app.core.langgraph.nodes.voice_compose import compose
from app.core.langgraph.nodes.voice_output_guardrails import output_guardrails
from app.core.langgraph.state import VoiceState
from app.core.langgraph.tools import tools
from app.core.logging import logger


class VoiceAgent(BaseChannelAgent):
    """Runs the compose/output-guardrails loop over the voice channel."""

    agent_name = "voice_agent"
    state_cls = VoiceState
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
                logger.exception(
                    "graph_creation_failed",
                    agent_name=self.agent_name,
                    error=str(e),
                    environment=settings.ENVIRONMENT.value,
                )
                raise

        return self._graph


voice_agent = VoiceAgent()
