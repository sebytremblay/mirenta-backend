---
name: debug-agent-session
description: "Use to debug why a Mirenta agent call or SMS conversation misbehaved — find the session behind a user report (\"I called at 2pm about scheduling\", a phone number, a call SID, a contact name) and pull the full cross-system trace: Supabase rows, Temporal workflow history, LiveKit room/agent logs, Langfuse LLM traces, and Render backend/worker logs. Triggers: agent behavior failed, wrong reply, call dropped, no follow-up sent, tool call misfired, \"what was the agent doing on this call\", root-cause a voice or SMS interaction."
metadata:
  author: mirenta
  version: "0.1.0"
---

# Debug an agent session

Root-cause why a Mirenta voice call or SMS conversation misbehaved. A user gives you a loose handle — a phone number, a time window, "the call about scheduling", a contact name, a Twilio Call SID — and you turn it into one `contact_id`/`org_id` and then pull the whole trace across every system that touched the interaction.

Run this **from `mirenta-backend/`** (the `.env` and CLIs are configured relative to it).

## The one rule: resolve to `contact_id` first

Every system keys off `contact_id` (and `org_id`). Nothing else correlates until you have it. The identifier chain:

```
phone / email / name  ──► contacts row ──►  contact_id + org_id
Twilio CallSid  ──► signals.dedup_key (inbound_call) / interactions.provider_ref / SIP header X-Mirenta-Call-Sid
contact_id  ──► Temporal workflow  "contact-loop:{contact_id}"
            └─► Langfuse trace       session_id = "sms:{org_id}:{contact_id}"
task_id     ──► Temporal workflow  "task-exec:{task_id}"
LiveKit voice room ──► name prefix "call-*", agent "mirenta-voice", one room per call
```

So: **start with `resolve.py`** (below). It takes any handle and prints the `contact_id`, `org_id`, the matching `signals`/`interactions`/`tasks` rows, and the exact follow-up commands to run against each system. Do not hand-write Supabase queries before running it.

## Step 1 — resolve the session

```bash
# by phone (E.164 or partial), name, email, call SID, or contact_id
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --phone "+14155550123"
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --name "Jane Doe"
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --call-sid CAxxxxxxxx
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --contact-id <uuid>

# narrow by time when the user says "the call around 2pm" — filters signals/interactions
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --phone "+1415..." --around "2026-07-19T14:00" --window-min 90
```

The script reads `.env` for the direct Postgres connection (`SUPABASE_DB_*`) and prints, for the matched contact: recent `signals`, `interactions` (with `transcript`, `outcome`, `guardrail_flags`, `provider_ref`, token counts), and `tasks` (with `status`, `type`, `temporal_workflow_id`, `error`). It ends with a **"Next commands"** block — copy those; they already have the right IDs filled in.

If more than one contact matches, it lists candidates and stops — pick one and re-run with `--contact-id`.

## Step 2 — pull the trace from the system that owns the failure

Pick by symptom. Each command's IDs come from Step 1's output.

| Symptom | System | Where the answer is |
|---|---|---|
| Wrong / off-tone reply, hallucination, ignored knowledge | **Langfuse** | the actual LLM input/output, prompt, and injected knowledge |
| Call connected but agent did nothing / dropped / wrong tool | **LiveKit** | agent logs, room lifecycle, STT/TTS/LLM pipeline errors |
| No follow-up fired, task stuck, decision engine skipped a channel | **Temporal** | workflow event history, timers, activity failures |
| 4xx/5xx on a webhook, signature reject, bootstrap/finalize failure | **Render** (or local `logs/`) | structured backend/worker logs |
| "Was the call even received?" / consent or DNC block | **Supabase** (Step 1 already has it) | `signals` rows + `status` (`ignored` = blocked, `delivered` = dialed) |

### Langfuse — what the LLM actually saw and said

The SMS subagent traces every call with `session_id = sms:{org_id}:{contact_id}` and metadata `contact_id` / `task_id` / `task_goal`. **Voice runs on LiveKit's native pipeline, not LangGraph — its per-turn LLM calls are in LiveKit logs, not Langfuse** (only the SMS path and the legacy voice graph emit Langfuse traces).

Open the session directly (host + keys are in `.env`):

```bash
# builds the Langfuse UI URL for this session from .env LANGFUSE_BASE_URL
uv run python .agents/skills/debug-agent-session/scripts/resolve.py --contact-id <uuid> --langfuse-url
```

Read the trace for: the rendered system prompt, the `knowledge` block that was injected (empty knowledge → generic answers), guardrail retries (up to 3 `compose` attempts), and whether it escalated (`guardrail_escalated`). See `docs/observability.md` and `docs/llm-service.md`.

### Temporal — the durable loop and scheduled tasks

`.env` has `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_KEY`, `TEMPORAL_TLS`. Export them for the CLI, or use the flags directly:

```bash
set -a; source .env; set +a
TFLAGS="--address $TEMPORAL_ADDRESS --namespace $TEMPORAL_NAMESPACE --api-key $TEMPORAL_KEY --tls"

# the contact's long-running event loop — decisions, state patches, task emission
temporal workflow show $TFLAGS --workflow-id "contact-loop:<contact_id>"

# a specific task's execution (delivery, durable sleep, cancel-on-inbound)
temporal workflow show $TFLAGS --workflow-id "task-exec:<task_id>"

# describe = current status/pending activities; show = full event history
temporal workflow describe $TFLAGS --workflow-id "contact-loop:<contact_id>"
```

Read the event history for: which `signal_received` envelopes arrived, `decision.engine.evaluate` outputs (via activity results), activity failures/retries, and timer state (a follow-up that never fired shows as a still-open timer or a cancelled `task-exec`). Architecture: `docs/architecture.md`; workflow internals: `workflows/CLAUDE.md`, `activities/CLAUDE.md`.

### LiveKit — voice call pipeline

`.env` has `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_AGENT_NAME` (`mirenta-voice`). The `lk` CLI reads these from env. Rooms are named `call-*` (one per call, dispatch rule in `livekit_agent/sip/dispatch-rule.json`).

```bash
set -a; source .env; set +a

# live calls only (rooms are ephemeral — this is empty for a call that already ended)
lk room list

# agent worker logs — the STT/TTS/LLM pipeline, bootstrap/finalize, shutdown reasons
lk agent logs        # alias: lk agent tail
lk agent status
lk agent versions    # confirm the deployed agent has the code you expect (deploys separately from Render)
```

Correlate a specific past call by its `call_sid` in the **backend** logs (LiveKit → FastAPI `/internal/voice/bootstrap` and `/finalize` log `call_sid`, `room`, `interaction_id`, `outcome`). Key backend events: `twilio_voice_dialed_to_livekit`, `twilio_voice_call_blocked` (DNC/consent), `voice_bootstrap_failed`, `voice_room_metadata_incomplete` (missing correlation headers → agent shuts down), `voice_session_finalized`. A call that reached Twilio but never hit LiveKit is a webhook/SIP problem — check `twilio_voice_sip_bridge_not_configured` and whether `LIVEKIT_SIP_URI` is set. LiveKit agent details: `livekit_agent/AGENTS.md`, `livekit_agent/src/CLAUDE.md`.

### Render — production backend & worker logs

Two services, both auto-deploy from `main`:

| Service | Render ID | Runs |
|---|---|---|
| `mirenta-backend` (web) | `srv-d997pobtqb8s73a8cv6g` | FastAPI: webhooks, `/internal/voice/*`, dashboard API |
| `mirenta-temporal-worker` (worker) | `srv-d9eovgmrnols73elqmig` | Temporal worker: runs the workflows + activities |

```bash
# webhook / voice-bridge / signature failures live on the web service
render logs -o json --confirm --resources srv-d997pobtqb8s73a8cv6g --text "<call_sid or contact_id>" --limit 200

# decision-engine / task-execution / SMS-send failures live on the worker
render logs -o json --confirm --resources srv-d9eovgmrnols73elqmig --text "<contact_id>" --limit 200

# time-box it, or tail live while reproducing
render logs --confirm --resources srv-d997pobtqb8s73a8cv6g --start 2026-07-19T14:00:00Z --end 2026-07-19T15:00:00Z
render logs --confirm --resources srv-d997pobtqb8s73a8cv6g --tail
```

Logs are structlog JSON. Every line carries `request_id`, `contact_id`, `org_id`, and `session_id` when available (bound by `LoggingContextMiddleware`) — filter on any of them. Event names are `lowercase_with_underscores`. Grep the `X-Request-ID` from a webhook response to pin one request end-to-end.

**Local dev** logs are on disk instead: `logs/{environment}-{YYYY-MM-DD}.jsonl` (e.g. `logs/development-2026-07-20.jsonl`). Search with `rg '"<contact_id>"' logs/*.jsonl` — richer than stdout, one file per day.

## Step 3 — report the root cause

State the failure in terms of *which system* broke and cite the evidence: the log event name, the Temporal activity, the Langfuse trace, or the `signals.status`. Distinguish a **blocked** call (`signals.status = ignored`, DNC/consent — working as designed) from a **broken** one (activity error, bootstrap failure, guardrail escalation). Tie the symptom the user reported to the concrete row/trace so the fix is obvious.

## Notes on auth

- The **`.env` in `mirenta-backend/` is the source of truth** for every credential this skill needs — Supabase Postgres, Temporal Cloud, LiveKit, Langfuse. `resolve.py` and the `source .env` snippets read it directly; you should not need a separate login for Supabase/Temporal/LiveKit/Langfuse.
- **Render is the exception**: it uses CLI session auth, not `.env`. `render` is already logged in to the **Mirenta** workspace here. If a `render` command returns an auth error, tell the user to run `! render login` (it opens a browser) — do not attempt to store a Render token in `.env`.
- Never print secret values. `resolve.py` only echoes IDs and non-secret URLs.
