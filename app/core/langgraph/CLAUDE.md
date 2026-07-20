# app/core/langgraph/ — per-channel LangGraph subagents

## Live vs legacy

- **`sms_graph.py` (`SMSAgent`) is the only graph on a live production path.** It's invoked from `activities/interactions.py` (a Temporal activity), not directly from a router.
- **`voice_graph.py` (`VoiceAgent`) is legacy/unused on the call path.** Live inbound voice runs through the LiveKit Cloud agent (`livekit_agent/`), which uses LiveKit's own native LLM pipeline, not LangGraph. `voice_graph.py` is kept for experiments / a possible future LangGraph↔LiveKit adapter — don't assume changes here affect real calls.
- Both subclass `BaseChannelAgent` (`base.py`) but **override `create_graph()` entirely** — they don't use the shared chat/tool-call graph `base.py` builds by default (that default graph is unused by both channels today; it exists as the generic template shape `BaseChannelAgent` was built around).

## Gotcha: voice legacy graph loads the SMS prompt

`nodes/voice_compose.py` calls `load_system_prompt()` (`app/core/prompts/__init__.py`), which is a hardcoded alias for `load_sms_prompt()` — it renders `sms.md`, **not** `voice.md`. Since `voice_graph.py` is legacy/unused this doesn't affect production behavior, but if you ever wire the legacy voice graph back up, fix this to call `load_voice_prompt()` instead. The live voice path (`app/api/routers/voice.py`'s `bootstrap_voice_session`) already calls `load_voice_prompt()` correctly — this mismatch is isolated to the unused LangGraph voice graph.

## `state.py`

`SMSState`/`VoiceState` both extend `GraphState` (`app/schemas/graph.py`) with identical fields today (`goal`, `channel_constraints`, `knowledge`, `draft`, `guardrail_attempts`, `guardrail_feedback`) — kept as separate classes so channel-specific fields (e.g. `VoiceState.call_sid`) can diverge later without touching SMS.

## `nodes/` — the compose ↔ output_guardrails loop

Both `sms_graph.py` and `voice_graph.py` wire the same two-node loop (`compose <-> output_guardrails`, max 3 attempts, entry/finish point `compose`):

- **`compose.py` / `voice_compose.py`** — the LLM call that drafts the message/turn. `goal`/`channel_constraints`/`knowledge` come from `get_response(..., metadata=...)` on the first pass and get persisted onto state so later retry iterations don't re-read config. `compose.py`'s `GOAL_INSTRUCTIONS` dict maps task goals (`reply_to_inbound_sms`, `follow_up_no_response`) to extra prompt instructions — add new goals there. `voice_compose.py` additionally prepends `VOICE_STYLE_INSTRUCTIONS` (short spoken sentences, no markdown, don't re-greet) and calls the LLM with `settings.VOICE_LLM_MODEL` instead of the default.
- **`output_guardrails.py` / `voice_output_guardrails.py`** — deterministic-only checks (no LLM) run after `compose`, before anything is sent/spoken:
  - SMS: length ≤ `channel_constraints["max_length"]` (default 320), **must contain** the word "stop" (opt-out language — TCPA/SMS convention), plus the shared checks below.
  - Voice: length ≤ `channel_constraints["max_length"]` (default 600), no STOP-language requirement (voice has no equivalent convention — see the module docstring; handling a spoken "stop calling me" is an unbuilt business-logic classification problem, not a guardrail).
  - Both: `_shared_checks.check_prohibited_claims` (keyword list: "guaranteed cure", "100% effective", "no side effects") and `check_pii` (regex for SSN, credit-card-shaped numbers).
  - On violation: retries `compose` with `guardrail_feedback` set, up to `MAX_GUARDRAIL_ATTEMPTS=3`; on the 3rd failure, escalates with a hardcoded fallback message (`additional_kwargs={"guardrail_escalated": True, "violations": [...]}`) instead of sending the bad draft.
- **`_shared_checks.py`** — intentionally the only file shared between the SMS and voice guardrail nodes, so the prohibited-claim/PII patterns can't drift between channels. Channel-specific checks (length cap, STOP requirement) deliberately stay in each channel's own node file.

## `tools/`

Empty (`tools: list[BaseTool] = []` in `tools/__init__.py`) — the old template's demo tools were removed and nothing channel-specific has been added yet. Both `SMSAgent.tools` and `VoiceAgent.tools` point at this same empty list.

## `base.py`

`BaseChannelAgent` provides: Postgres connection pooling (`_get_connection_pool`, degrades to `None` in production rather than crashing, raises in dev/test), `AsyncPostgresSaver` checkpointing (`_build_checkpointer`), message trimming to `settings.MAX_TOKENS` (`_prepare_messages`), and `get_response`/`get_stream_response`/`get_chat_history`/`clear_chat_history` — the public surface both `SMSAgent`/`VoiceAgent` call through. `clear_chat_history` deletes rows across all of `settings.CHECKPOINT_TABLES` for a `thread_id` in one pipelined transaction.
