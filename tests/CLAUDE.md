# tests/

Router only. Run the full suite with `uv run --group test pytest` (pytest lives in the `test` dependency group, not the default `uv sync`) from the repo root — see leaf `CLAUDE.md` files for the precise invocation scoped to each subtree.

- `decision/` — pure unit tests for the deterministic decision engine (`decision/`). No I/O, no clock, no mocks beyond `factories.py`.
- `langgraph/` — unit tests for individual LangGraph node functions in isolation, not the compiled graph.
- `services/` — unit tests for domain helpers and external-SDK client wrappers (`services/clients/`).
- `services/runtimes/` — empty except `__init__.py`; mirrors the reserved `app/services/runtimes/` module (voice runtime moved to `livekit_agent/`). Nothing to run here yet.

There's no `conftest.py` anywhere in this tree — tests build what they need inline or via `decision/factories.py`.
