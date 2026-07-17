# app/agent_tools/ — one tool definition, every runtime

Shared tool layer behind both agent runtimes. A tool is defined **once** here and
binds into both the request/response text runtime (`BaseChannelAgent` — SMS,
email, website) and the streaming voice runtime (`livekit_agent/`). The turn
loops legitimately differ per channel; the tool *business logic* should not.

Start from the worked example: **`examples.py`** (`lookup_org_knowledge`,
`request_meeting`). Both are tagged `"example"` so they never bind into a real
channel by accident — copy the shape, then delete them once real tools land.

## Anatomy

- **`context.py`** — `ToolContext`: framework-neutral correlation ids
  (`org_id`, `contact_id`, `channel`, `thread_id`/`call_sid`, ...). This is the
  piece that makes sharing work. A tool body cannot read LangGraph's
  `RunnableConfig` or LiveKit's session userdata, so each **binder** populates a
  `ToolContext` from its runtime's ambient state and passes it in. Keep this file
  free of LangChain/LangGraph/LiveKit imports.
- **`registry.py`** — `@register(...)` records an `AgentTool` (name,
  description, Pydantic `args_model`, `channels`, `durable`, `tags`). A tool body
  is `async def fn(context: ToolContext, args: BaseModel) -> str`. Discover with
  `get_tools(channel=..., tags=...)`.
- **`binders.py`** — `to_langchain_tool` (→ `StructuredTool` for
  `LLMService.bind_tools`) and `to_livekit_function_tool` (→ LiveKit
  `function_tool`). Both derive the schema from `args_model` — no per-tool,
  per-SDK glue. **`livekit-agents` is not a main-app dependency** (that project
  has its own `pyproject.toml`), so the LiveKit binder imports the SDK lazily and
  only runs inside the voice worker; importing `binders.py` never requires it.
- **`temporal_bridge.py`** — `emit_tool_signal`: the durable-effect path (below).

## The two tool shapes

| Shape | `durable` | Side effect | Example |
|---|---|---|---|
| Read-only lookup | `False` | none — runs inline, safe on a live voice turn | `lookup_org_knowledge` |
| State mutation | `True` | routes through Temporal, never inline | `request_meeting` |

**Durable tools must not mutate contact/outreach state inline.** That would
bypass the decision engine's idempotency, retry, and compliance guarantees — the
"deterministic core, generative edge" invariant in the root `AGENTS.md`. Instead
call `emit_tool_signal(context, signal_type=..., payload=...)`, which inserts a
`signals` row and delivers it to the contact's `ContactLoopWorkflow` via
**signal-with-start** (the same pattern as
`activities/logging.py::emit_interaction_result_signal` — no-op start when the
loop already runs, clean start for a brand-new contact mid-call). The tool
returns an acknowledgement immediately; the engine decides what task (if any) to
emit on the next tick.

Two gotchas when writing a durable tool:
- `signal_type` must be a valid `app/schemas/signals.py::SignalType` literal.
  Agent-initiated events use `"manual"`; carry the specific intent in `payload`
  (e.g. `{"tool": "request_meeting", ...}`). Adding a new type means editing the
  `SignalType` literal first.
- Guard on `temporal_available()` so a playground/console session (no durable
  runtime) degrades to a plain acknowledgement instead of crashing the turn.

## Wiring a tool into a runtime

- **Text (`BaseChannelAgent`)**: build a `ToolContext` from the graph's metadata,
  then `build_langchain_tools(get_tools(channel="sms"), context)` and pass to
  `bind_tools`. Note: the shared `llm_service` singleton is bound once per agent
  at `__init__` today (see `app/core/langgraph/CLAUDE.md`) — per-invocation
  context binding needs a small refactor of that call site, not a change here.
- **Voice (`livekit_agent/`)**: inside the worker, build a `ToolContext` from the
  SIP participant attributes and pass
  `[to_livekit_function_tool(t, ctx) for t in get_tools(channel="voice")]` as the
  `Agent(tools=...)` list.

## Adding a real tool

1. Add an `async def` wrapping `app/services/` domain logic (do not re-implement
   domain logic here — this layer is glue).
2. `@register` it with an `args_model`, `channels`, correct `durable` flag, and
   real tags (drop `"example"`).
3. Add a unit test under `tests/agent_tools/` (async via `asyncio.run`, mock the
   service call — see `test_examples.py`).

## Tests

`tests/agent_tools/` — registry filtering, context injection through the
LangChain binder, and both example shapes (read-only + durable). The LiveKit
binder is not exercised in the main app's suite because `livekit-agents` is not
installed here; it is covered structurally and by the voice worker's own project.
