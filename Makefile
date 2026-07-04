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
        lint format typecheck check pre-commit pre-commit-update \
        clean help
