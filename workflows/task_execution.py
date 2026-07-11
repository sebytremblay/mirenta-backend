"""Child workflow: execute one task with retries.

Re-checks guardrails at execution time (`tasks.guardrail_result`) — not
just at decision/emission time — and sleeps on a durable Temporal timer
until `scheduled_for`, per `docs/architecture.md#4--task-scheduler`.
"""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

from decision.guardrails import run_hard_guardrails
from workflows.models import TaskExecutionInput

with workflow.unsafe.imports_passed_through():
    from activities import channels, contact_store, interactions
    from activities import logging as logging_activities

ACTIVITY_TIMEOUT = timedelta(seconds=30)
INTERACTION_TIMEOUT = timedelta(seconds=90)  # LLM call budget + margin
DEFAULT_RETRY_POLICY = RetryPolicy(maximum_attempts=5)


@workflow.defn
class TaskExecutionWorkflow:
    """Executes one `Task` row: sleep until due, re-check guardrails, run the interaction."""

    @workflow.run
    async def run(self, input: TaskExecutionInput) -> None:
        """Execute the task identified by `input.task_id`."""
        task = await workflow.execute_activity(
            contact_store.get_task,
            input.task_id,
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )

        delay_seconds = (task.scheduled_for - workflow.now()).total_seconds()
        if delay_seconds > 0:
            # The actual durable timer -- survives worker restarts/deploys.
            await workflow.sleep(delay_seconds)

        # Re-fetch after sleep: a newer inbound may have canceled this task,
        # and guardrails must reflect reality at execution time.
        task = await workflow.execute_activity(
            contact_store.get_task,
            input.task_id,
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        if task.status == "canceled":
            return

        contact = await workflow.execute_activity(
            contact_store.get_contact,
            str(task.contact_id),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        contact_state = await workflow.execute_activity(
            contact_store.get_or_create_contact_state,
            contact_store.GetOrCreateContactStateInput(contact_id=str(task.contact_id), org_id=str(task.org_id)),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        consent = await workflow.execute_activity(
            contact_store.get_current_consent,
            contact_store.GetConsentInput(contact_id=str(task.contact_id), channel="sms"),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )

        denials = run_hard_guardrails(
            contact=contact, contact_state=contact_state, consent=consent, channel="sms", now=workflow.now()
        )
        if denials:
            await workflow.execute_activity(
                contact_store.update_task_status,
                contact_store.UpdateTaskStatusInput(
                    task_id=input.task_id,
                    status="skipped_guardrail",
                    guardrail_result={"denials": [denial.model_dump() for denial in denials]},
                ),
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=DEFAULT_RETRY_POLICY,
            )
            return

        await workflow.execute_activity(
            contact_store.update_task_status,
            contact_store.UpdateTaskStatusInput(
                task_id=input.task_id, status="running", guardrail_result={"passed": True}, mark_started=True
            ),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )

        if task.type != "sms":
            # Only the SMS channel is wired up this pass -- see docs/architecture.md's status table.
            await workflow.execute_activity(
                contact_store.update_task_status,
                contact_store.UpdateTaskStatusInput(
                    task_id=input.task_id, status="failed", error="unsupported task type in this pass"
                ),
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=DEFAULT_RETRY_POLICY,
            )
            return

        org = await workflow.execute_activity(
            contact_store.get_organization,
            str(task.org_id),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        result = await workflow.execute_activity(
            interactions.run_interaction,
            interactions.RunInteractionInput(task=task, contact=contact, contact_state=contact_state),
            start_to_close_timeout=INTERACTION_TIMEOUT,
            retry_policy=RetryPolicy(maximum_attempts=task.max_attempts),
        )

        if result.reply and contact.phone and (org.twilio_messaging_service_sid or org.phone):
            await workflow.execute_activity(
                channels.send_sms_message,
                channels.SendSmsInput(
                    to=contact.phone,
                    from_=org.phone,
                    body=result.reply,
                    messaging_service_sid=org.twilio_messaging_service_sid,
                    subaccount_sid=org.twilio_subaccount_sid,
                ),
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

        # No outcome-classification node exists on the SMS graph yet (future
        # work) -- escalation is the one outcome distinction available today.
        outcome = "handoff_human" if result.guardrail_escalated else "progressed"
        guardrail_flags = [{"violation": violation} for violation in result.guardrail_violations]

        interaction_id = await workflow.execute_activity(
            logging_activities.log_interaction,
            logging_activities.LogInteractionInput(
                org_id=str(task.org_id),
                contact_id=str(task.contact_id),
                task_id=str(task.id),
                channel="sms",
                direction="outbound",
                agent_graph=result.agent_graph,
                transcript=result.transcript_turn,
                outcome=outcome,
                guardrail_flags=guardrail_flags,
            ),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        await workflow.execute_activity(
            logging_activities.emit_interaction_result_signal,
            logging_activities.EmitInteractionResultSignalInput(
                org_id=str(task.org_id),
                contact_id=str(task.contact_id),
                interaction_id=interaction_id,
                channel="sms",
                outcome=outcome,
                summary=None,
                task_goal=result.task_goal,
            ),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        await workflow.execute_activity(
            contact_store.update_task_status,
            contact_store.UpdateTaskStatusInput(task_id=input.task_id, status="completed", mark_completed=True),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
