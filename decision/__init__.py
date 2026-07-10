"""Deterministic decision engine — zero LLM calls, zero app.core.langgraph imports.

Given `(signal, contact_state)` this package emits the same `tasks` every
time (see `docs/architecture.md#3--decision-engine-deterministic-core`).
Safe to import directly into Temporal workflow code: no I/O, no randomness,
no wall-clock reads (callers always pass `now` explicitly).
"""
