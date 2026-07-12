# syntax=docker/dockerfile:1

ARG PYTHON_VERSION=3.13
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS base

ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV HF_HOME=/app/.cache/huggingface
ENV TORCH_HOME=/app/.cache/torch

FROM base AS build

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    python3-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first for cache; --locked matches uv.lock for reproducible Cloud builds.
COPY pyproject.toml uv.lock ./
RUN mkdir -p src && uv sync --locked

# Pre-download plugin models before copying app code so code-only changes stay cached.
RUN uv run --module livekit.agents download-files

COPY src ./src

FROM base

ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

COPY --from=build --chown=appuser:appuser /app /app

WORKDIR /app
USER appuser

# LiveKit Cloud runs this as the agent worker process.
CMD ["uv", "run", "src/agent.py", "start"]
