# livekit_agent/src/

`agent.py` branches on participant kind at `entrypoint()`: non-SIP joins (console, Agent Console, manual browser) get `_start_console_session` with the hardcoded `_CONSOLE_GREETING`/`_CONSOLE_INSTRUCTIONS` and skip Mirenta entirely; SIP joins call `_wait_for_mirenta_context` (polls up to `_SIP_ATTR_WAIT_SECONDS` since trunk `headers_to_attributes` can arrive after the participant joins) then require all four ids (`org_id`, `contact_id`, `signal_id`, `call_sid`) non-empty or it shuts down with `reason="missing_mirenta_metadata"`.

- `call_context.py` — pure, no LiveKit imports (kept unit-testable). `merge_call_context` prefers SIP participant attributes (`mirenta.org_id` etc., set by the trunk's `headers_to_attributes` — see `../sip/inbound-trunk.json`) and falls back to job/room metadata JSON for explicit API dispatch. `infer_outcome` is a one-line heuristic: any assistant turn in the transcript → `"progressed"`, else `"no_answer"`.
- `mirenta_client.py` — `MirentaVoiceClient.bootstrap`/`finalize` POST to `{MIRENTA_API_BASE_URL}{API_PREFIX}/internal/voice/bootstrap` and `/internal/voice/finalize`, authenticated with `X-Mirenta-Internal-Key` (`MIRENTA_INTERNAL_API_KEY`) — not the Supabase JWT flow the rest of the backend uses. `finalize` is what lets `ContactLoopWorkflow` re-enter after a call ends.

Keep `agent.py` as the entrypoint (`Dockerfile` CMD / LiveKit Cloud) when adding modules — don't rename it.
