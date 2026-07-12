.DEFAULT_GOAL := help

ENV ?= development

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Shorthand: source env vars then run a command
run_with_env = bash -c "source scripts/set_env.sh $(ENV) && $(1)"

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
install:
	pip install uv
	uv sync
	uv run pre-commit install

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
dev:
	@$(call run_with_env,uv run uvicorn app.main:app --reload --port 8000)

staging:
	@$(call run_with_env,$(MAKE) _serve ENV=staging)

prod:
	@$(call run_with_env,$(MAKE) _serve ENV=production)

_serve:
	@$(call run_with_env,./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --loop uvloop)

# ---------------------------------------------------------------------------
# Temporal
# ---------------------------------------------------------------------------
temporal-up:
	docker compose up -d temporal temporal-ui

temporal-down:
	docker compose down

worker:
	@$(call run_with_env,uv run python -m worker.main)

# ---------------------------------------------------------------------------
# LiveKit voice agent (Cloud-hosted in production; local for debug)
# ---------------------------------------------------------------------------
voice-agent-dev:
	@$(call run_with_env,cd livekit_agent && uv sync && uv run src/agent.py dev)

voice-agent-console:
	@$(call run_with_env,cd livekit_agent && uv sync && uv run src/agent.py console)

voice-agent-deploy:
	@cd livekit_agent && \
	  if [ ! -f livekit.toml ]; then \
	    echo "No livekit.toml — from livekit_agent/ run: lk agent create --project <name>"; \
	    exit 1; \
	  fi; \
	  lk agent deploy

voice-agent-test:
	@cd livekit_agent && uv sync --group dev && uv run pytest

# ---------------------------------------------------------------------------
# Code quality
# ---------------------------------------------------------------------------
lint:
	uv run ruff check .

format:
	uv run ruff format .

typecheck:
	uv run pyright

check: lint typecheck
	@echo "All checks passed"

pre-commit:
	uv run pre-commit run --all-files

pre-commit-update:
	uv run pre-commit autoupdate

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
clean:
	rm -rf .venv __pycache__ .pytest_cache

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
help:
	@echo "Usage: make <target> [ENV=development|staging|production|test]"
	@echo ""
	@echo "Setup:"
	@echo "  install              Install deps, set up pre-commit hooks"
	@echo ""
	@echo "Server:"
	@echo "  dev                  Dev server with hot reload (port 8000)"
	@echo "  staging              Staging server"
	@echo "  prod                 Production server"
	@echo ""
	@echo "Temporal:"
	@echo "  temporal-up          Start local Temporal server + UI (docker-compose)"
	@echo "  temporal-down        Stop the local Temporal stack"
	@echo "  worker               Run the Temporal worker (registers workflows + activities)"
	@echo ""
	@echo "LiveKit voice:"
	@echo "  voice-agent-dev      Run the LiveKit agent locally (Cloud jobs / Agent Console)"
	@echo "  voice-agent-console  Local mic/speakers console (no LiveKit room required)"
	@echo "  voice-agent-deploy   Deploy livekit_agent/ to LiveKit Cloud (requires lk CLI)"
	@echo "  voice-agent-test     Run livekit_agent/ unit tests"
	@echo ""
	@echo "Code quality:"
	@echo "  lint                 Ruff lint check"
	@echo "  format               Ruff format"
	@echo "  typecheck            Pyright static type check"
	@echo "  check                Run lint + typecheck"
	@echo "  pre-commit           Run all pre-commit hooks"
	@echo "  pre-commit-update    Update pre-commit hook versions"
	@echo ""
	@echo "Misc:"
	@echo "  clean                Remove .venv, __pycache__, .pytest_cache"

.PHONY: install dev staging prod _serve \
        temporal-up temporal-down worker \
        voice-agent-dev voice-agent-console voice-agent-deploy voice-agent-test \
        lint format typecheck check pre-commit pre-commit-update \
        clean help
