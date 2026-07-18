# LiveKit Agents project (Mirenta voice)

This is a nested LiveKit Agents worker deployed to LiveKit Cloud. It runs the
Deepgram STT/TTS + OpenAI LLM session and can optionally bootstrap/finalize
against Mirenta's FastAPI. Use console / Agent Console / WebRTC for local and
Cloud testing; real Twilio phone numbers are bridged into this agent via a
LiveKit Cloud SIP inbound trunk + dispatch rule (`sip/inbound-trunk.json`,
`sip/dispatch-rule.json` — created once via the `lk` CLI, see
`docs/configuration.md`). Twilio dials the trunk from
`app/api/routers/voice.py::receive_twilio_call` when `LIVEKIT_SIP_URI` is set.

## Project structure

Use `uv` for install, run, and test. App code lives in `src/`:

- `src/agent.py` — required entrypoint (`Dockerfile` CMD / LiveKit Cloud)
- `src/call_context.py` — participant/metadata helpers (unit-tested, no Agents imports)
- `src/mirenta_client.py` — bootstrap + finalize HTTP client to FastAPI

`sip/` holds the checked-in inbound trunk + dispatch rule request bodies used
to (re)create the LiveKit Cloud SIP resources — not read by the agent at
runtime.

Keep `agent.py` as the entrypoint when adding modules.

Branching: SIP participants (real Twilio calls) and any join carrying Mirenta
correlation metadata (participant attrs / job metadata) go through
bootstrap/finalize. Everything else (Agent Console, `agent.py console`,
manual browser joins) is treated as a playground session with default
instructions — no Mirenta API calls.

## Commands

```bash
cd livekit_agent
uv sync --group dev
uv run src/agent.py download-files   # first run / after plugin upgrades
uv run src/agent.py console          # local mic/speakers
uv run src/agent.py dev              # Cloud jobs / Agent Console
uv run pytest                        # unit tests
```

From the repo root: `make voice-agent-console`, `make voice-agent-dev`,
`make voice-agent-deploy`.

Deployment is automated: a push to `main` that touches `livekit_agent/`
triggers the `Deploy voice agent` GitHub Actions workflow
(`.github/workflows/deploy-voice-agent.yml`), which runs
`scripts/deploy.sh`. Deploy by hand only when working off `main`. The agent
ships separately from the Render backend, so skipping a redeploy leaves the
deployed agent on older code (for example missing a newly added voice tool)
even when the backend is current. `scripts/deploy.sh` never sends secrets, so
existing agent secrets persist across deploys; change them with
`lk agent update-secrets`, not through a deploy.

## Docs

Prefer current LiveKit docs (`lk docs` or https://docs.livekit.io/agents/) over
older blog posts. Agent testing helpers:
https://docs.livekit.io/agents/start/testing/
