# worker/

`main.py` registers on `task_queue=settings.TEMPORAL_TASK_QUEUE` (not hardcoded — check `.env`/`app/core/config.py` for the actual value per environment).

**If you add a new activity or workflow, register it here or the worker silently won't run it** — Temporal doesn't discover activities/workflows by import side-effect; `ACTIVITIES` is a hand-maintained list and `Worker(..., workflows=[...])` is a hand-maintained list, both in this file. Current registration:
- Workflows: `ContactLoopWorkflow`, `TaskExecutionWorkflow`.
- Activities: everything currently in `activities/contact_store.py` (10 activities), `interactions.run_interaction`, `channels.send_sms_message`, and both of `activities/logging.py`'s (`log_interaction`, `emit_interaction_result_signal`).

Adding a new activity function to `activities/*.py` without also adding it to this file's `ACTIVITIES` list produces a runtime "activity not registered" error the first time a workflow tries to call it — not a startup-time or type-check-time failure.
