"""Temporal activities.

Side effects (Supabase reads/writes, LangGraph calls, Twilio sends) live
here, invoked from `workflows/` via `workflow.execute_activity`.
"""
