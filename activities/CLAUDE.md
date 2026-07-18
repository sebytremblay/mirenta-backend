# activities/

## channels.py — `send_sms_message`

Wraps `app.services.clients.twilio_client.send_sms`. If `subaccount_sid` and `org_id` are both set, it first calls `app.api.twilio_utils.load_org_twilio_auth_token` (via `get_service_role_client()`) to fetch that org's per-subaccount auth token before sending — orgs without a Twilio subaccount send with the platform's default credentials instead. Called only from `workflows/task_execution.py` after a successful `interactions.run_interaction` that produced a `reply`.

## contact_store.py — Supabase reads/writes, no LLM

Every activity here goes through `get_service_role_client()` (never the user-scoped client — these tables have RLS enabled with no policies, per AGENTS.md). Notable non-obvious behavior:
- `get_or_create_contact_state`: `contact_state` has no default-insert trigger, so this auto-creates a bare row on first signal for a contact (mirrors `get_or_create_contact_by_phone`'s pattern elsewhere in the codebase). Called by both `workflows/contact_loop.py` and `workflows/task_execution.py`.
- `insert_task`: relies on the DB-level unique constraint on `tasks.idempotency_key` (`0005_tasks.sql`). On a `23505` (`UNIQUE_VIOLATION`) `APIError`, it doesn't raise — it fetches and returns the *existing* row by that idempotency key instead, so a Temporal activity retry that already succeeded server-side becomes a no-op read rather than a duplicate task.
- `cancel_scheduled_follow_ups`: only cancels tasks matching `status="scheduled"`, `type="sms"`, and `payload` containing `{"goal": "follow_up_no_response"}` (via `.contains`) — it will not touch a task that's already `running`/`completed`, nor a differently-goaled scheduled SMS task. `workflows/task_execution.py`'s re-fetch-after-sleep check is what actually makes this cancellation effective (this activity only flips the DB row; the sleeping workflow has to notice on wake).
- `mark_signal_processed` sets `status="processed"`/`processed_at` — distinct from `delivered_at`, which gets set earlier by the webhook router the moment the signal is merely handed to Temporal (not covered in this subtree).

## interactions.py — the LangGraph seam

This is the **only** file under `activities/` (and one of the only files anywhere outside `app/core/langgraph/`) allowed to import from `app.core.langgraph` — it imports `app.core.langgraph.sms_graph.sms_agent` directly. Keep any new channel-subagent wiring here, not in `workflows/` or `decision/`.

`run_interaction`:
- Derives `goal` from `task.payload["goal"]` (default `reply_to_inbound_sms`); if `goal == "follow_up_no_response"` and there's no inbound body, substitutes a synthetic `FOLLOW_UP_HUMAN_PROMPT` system-note string as the human turn — the LLM always sees *some* human message, never an empty one.
- Fetches org knowledge via `app.services.knowledge.fetch_active_knowledge` + `format_knowledge_for_prompt` and passes it in `metadata["knowledge"]`, alongside `metadata["memory_summary"]` from `contact_state.memory_summary` — this is the KB-injection point AGENTS.md refers to.
- `thread_id = f"sms:{org_id}:{contact_id}"` — deliberately matches the pre-Temporal scheme from `app/services/sms_interaction.py`, so LangGraph's `AsyncPostgresSaver` checkpoint history for a contact survives the cutover to Temporal-driven execution.
- Reply extraction walks `response_messages` in reverse looking for the last non-empty `AIMessage`; guardrail signals (`guardrail_escalated`, `violations`) are read off that message's `additional_kwargs`, not a separate return channel from the graph.
- Called only from `workflows/task_execution.py`, and only for `task.type == "sms"`.

## logging.py — closes the loop back into Temporal

`log_interaction` is a plain insert into `interactions`.

`emit_interaction_result_signal` is the activity that re-enters the contact's workflow: it inserts a new `signals` row (`type="interaction_result"`, `source="system"`, payload carries `interaction_id`/`outcome`/`summary`/`task_goal`), backfills `interactions.result_signal_id`, then calls `temporal_client.start_workflow(ContactLoopWorkflow.run, ..., id=f"contact-loop:{contact_id}", start_signal="signal_received", start_signal_args=[SignalEnvelope(...)])`. That's **signal-with-start**, not a plain `.signal()` on an existing handle — deliberately, because a task whose interaction just ended may belong to a contact with no currently-running `ContactLoopWorkflow` (e.g. first-ever contact), and signal-with-start is a no-op start when the workflow is already running. This is the one place in `activities/` that imports `workflows/contact_loop.py` and `workflows/models.py` — the dependency direction is activities → workflows here, opposite of the usual workflows → activities call direction elsewhere in this codebase.
