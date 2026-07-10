"""Plain LangGraph node functions, shared across channel graphs.

Kept as free functions (not bound methods) so they're independently
unit-testable and reusable if other channels adopt the same
compose/output-guardrails loop shape.
"""
