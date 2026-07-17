# decision/

## rules.py — what's actually decided

Two signal types are handled (`decision/engine.py`'s `SIGNAL_HANDLERS`); everything else is a no-op `DecisionOutput()`.

- **`decide_on_inbound_sms`**: runs `run_hard_guardrails` first — on denial, returns no tasks but still sets `cancel_scheduled_follow_ups=True` (a blocked inbound still supersedes a pending nudge). On pass, emits one `sms` task (`goal=reply_to_inbound_sms`, `scheduled_for=now` — quiet hours never deferred here), bumps `contact_attempts`/`attempts_window_start`, sets `current_state="awaiting_reply_send"`, clears `next_task_at`, and always cancels pending follow-ups.
- **`decide_on_interaction_result`**: reads `outcome` and `task_goal` from `signal.payload`. `opt_out`/`goal_achieved` short-circuit to a state patch only (`opted_out`/`goal_achieved`, `next_task_at=None`), no tasks, no guardrail check. Otherwise sets `current_state="active"` and decides whether to schedule the 3-day follow-up via `should_follow_up = outcome not in TERMINAL_OUTCOMES and source_goal != FOLLOW_UP_GOAL and contact.status != "dnc"` — i.e. a follow-up's own completion never re-schedules another follow-up (no infinite chain), and `TERMINAL_OUTCOMES = {opt_out, goal_achieved, handoff_human}` also blocks scheduling. If `should_follow_up`, guardrails run again; on denial the tasks list is dropped but the state patch (`memory_summary`, `last_contacted_at`) still returns. On pass, `scheduled_for = next_allowed_send_time(contact, now + 3 days)` — quiet hours *does* apply to this path, unlike the inbound-reply path above.

Both rules pass `sequence=0` to `derive_idempotency_key` — no rule in this file emits more than one task from a single signal yet.

## guardrails.py — what's checked, and when

`run_hard_guardrails` is three independent checks, all pure, all take `now` explicitly (never `datetime.now()` — see the module docstring's replay-determinism rationale):
- `check_dnc` — blocks solely on `contact.status == "dnc"`.
- `check_consent` — **default-allow**: only blocks on an explicit `consent.granted is False`; `consent is None` passes. Mirrors `app/services/sms_interaction.py`'s `_has_sms_consent`.
- `check_frequency_cap` — blocks only if `contact_attempts >= 3` (`FREQUENCY_CAP_MAX_ATTEMPTS`) **and** the window is still open (`now - attempts_window_start < 24h`). A stale window (>24h old) silently passes regardless of attempt count — nothing resets `attempts_window_start` in this file; that's on whatever writes `contact_state.contact_attempts` (currently only `decide_on_inbound_sms`'s patch).

Quiet hours (`is_quiet_hours`, `next_allowed_send_time`) is a separate, softer mechanism — a scheduling deferral, not a hard block, and not part of `run_hard_guardrails`. It only applies to proactive/delayed sends (the 3-day follow-up); inbound replies bypass it entirely. Local time is computed via `contact.timezone` (IANA string) through `zoneinfo`, not a fixed offset — a contact with a missing/invalid timezone string will raise in `ZoneInfo(...)`, not silently default to UTC.

## idempotency.py — how the key is actually derived

`derive_idempotency_key(signal_id, task_type, sequence)` = `sha256(f"{signal_id}:{task_type}:{sequence}")`, truncated to 32 hex chars, prefixed `f"{task_type}:{digest[:32]}"`. Determinism comes entirely from the inputs being deterministic: `signal_id` is a DB-assigned UUID already fixed before the engine runs, `task_type` is a static string literal per rule, and `sequence` is a static `0` passed by every current call site — no clock, no `uuid4()`, no random salt anywhere in the derivation. Two calls with identical `(signal_id, task_type, sequence)` always collide, which is the point: `activities/contact_store.py`'s `insert_task` relies on that collision hitting the `tasks.idempotency_key` unique constraint to make retried task insertion a no-op (catches `APIError` code `23505` and returns the existing row instead of raising).
