# tests/services/

Run just this subtree: `uv run --group test pytest tests/services/`

- `test_knowledge.py` — pure unit test for `app/services/knowledge.py`'s `format_knowledge_for_prompt`. No mocks, no I/O: builds `Knowledge` schema instances directly and asserts on the formatted prompt string (header text, `[kind] title` line format, content inclusion).
- `clients/` — tests for external-SDK wrapper modules (`app/services/clients/`); see `clients/CLAUDE.md` for what's mocked there.
- `runtimes/` — empty (`__init__.py` only), mirrors the reserved `app/services/runtimes/` module.
