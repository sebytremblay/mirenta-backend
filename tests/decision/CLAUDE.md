# tests/decision/

Run just this subtree: `uv run --group test pytest tests/decision/`

Pure unit tests for `decision/` (rules, guardrails, idempotency, engine) — no I/O, no real clock, no mocks. Every test passes an explicit `now: datetime` instead of calling `datetime.now()` inside the code under test, so behavior stays deterministic.

## `factories.py`

Test-only builders for the Pydantic schema instances the decision engine takes as input (`make_contact`, `make_contact_state`, `make_signal`, `make_current_consent`). Each has sane defaults (active status, `America/Los_Angeles`, a fresh `uuid4()`) and takes `**overrides` for anything a specific test needs to pin. Use these instead of constructing `Contact`/`ContactState`/`Signal`/`CurrentConsent` by hand — they keep required fields in sync as those schemas evolve, and every test file in this directory imports from here rather than duplicating construction logic.

## What each file protects

- `test_idempotency.py` — `derive_idempotency_key` is deterministic for the same `(signal_id, task_type, sequence)`, differs when any of those change, and is prefixed by task type. This is the guarantee that lets Temporal retries not double-emit a task (`tasks.idempotency_key` is unique).
- `test_guardrails.py` — the four independent guardrail checks (`check_dnc`, `check_consent`, `check_frequency_cap`, quiet-hours via `is_quiet_hours`/`next_allowed_send_time`). Note the quiet-hours tests are parametrized across timezones (`America/Los_Angeles`, `Asia/Tokyo`) to catch tz-conversion bugs, not just wall-clock-UTC ones.
- `test_rules.py` — the two signal handlers (`decide_on_inbound_sms`, `decide_on_interaction_result`) and `engine.evaluate`'s dispatch. Covers the DNC-blocks-task-emission path, the 3-day follow-up scheduling, follow-up-doesn't-chain (a follow-up's own `interaction_result` doesn't schedule another follow-up), and that an unhandled signal type returns an empty `DecisionOutput` rather than raising.
