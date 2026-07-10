"""Voice channel subagent — calls on behalf of the clinic.

Runs the same shared chat/tool-call loop as SMS today. Once LiveKit/Twilio
realtime wiring lands, this is where call-specific nodes (turn-taking,
barge-in, transcript streaming) get added by overriding ``_chat`` and
``create_graph`` — see docs/architecture.md §5 (Interaction layer).
"""

from app.core.langgraph.base import BaseChannelAgent
from app.core.langgraph.state import VoiceState
from app.core.langgraph.tools import tools


class VoiceAgent(BaseChannelAgent):
    """Runs the shared chat/tool-call loop over the voice channel."""

    agent_name = "voice_agent"
    state_cls = VoiceState
    tools = tools


voice_agent = VoiceAgent()
