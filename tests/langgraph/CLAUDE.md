# tests/langgraph/

Run just this subtree: `uv run --group test pytest tests/langgraph/`

These test individual graph node functions directly (calling `compose(state, config)` or a guardrail's `_check_draft(draft, constraints)`) rather than invoking a compiled `StateGraph` end-to-end — no checkpointer, no `AsyncPostgresSaver`, no real LLM call.

- `test_voice_compose.py` — `nodes/voice_compose.py`'s `compose` node. Patches `llm_service.call` and asserts the knowledge block passed via `config["metadata"]["knowledge"]` gets injected as a system message and mirrored back onto `command.update["knowledge"]`.
- `test_output_guardrails.py` — SMS `nodes/output_guardrails.py`'s `_check_draft`, a pure function. Covers missing STOP/opt-out language (SMS/TCPA-specific), max-length violations, SSN-pattern PII, and prohibited-claim language.
- `test_voice_output_guardrails.py` — the voice equivalent (`nodes/voice_output_guardrails.py`). Mirrors `test_output_guardrails.py` minus the STOP-keyword check, since voice has no SMS opt-out-keyword equivalent — don't add that assertion here, it doesn't apply.
