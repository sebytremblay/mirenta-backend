# LiveKit Agents project (Mirenta inbound voice)

This is a nested LiveKit Agents worker deployed to LiveKit Cloud. Twilio owns
phone numbers; FastAPI gates DNC/consent and SIP-dials LiveKit; this worker
runs the live Deepgram STT/TTS + OpenAI LLM session and finalizes back into
Mirenta's Temporal contact loop.

## Project structure

Use `uv` for install, run, and test. App code lives in `src/`:

- `src/agent.py` — required entrypoint (`Dockerfile` CMD / LiveKit Cloud)
- `src/call_context.py` — SIP/metadata helpers (unit-tested, no Agents imports)
- `src/mirenta_client.py` — bootstrap + finalize HTTP client to FastAPI

Keep `agent.py` as the entrypoint when adding modules.

Branching: Twilio phone calls join as `ParticipantKind.PARTICIPANT_KIND_SIP`
and go through Mirenta bootstrap/finalize. Everything else (Agent Console,
`agent.py console`, manual browser joins) is treated as a playground session
with default instructions — no Mirenta API calls.

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

## Docs

Prefer current LiveKit docs (`lk docs` or https://docs.livekit.io/agents/) over
older blog posts. Agent testing helpers:
https://docs.livekit.io/agents/start/testing/
