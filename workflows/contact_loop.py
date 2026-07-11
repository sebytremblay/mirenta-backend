"""Long-running per-contact workflow — the durable heart of the Mirenta Runtime loop."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.workflow import ParentClosePolicy

from decision.engine import evaluate
from workflows.models import ContactLoopInput, SignalEnvelope, TaskExecutionInput

with workflow.unsafe.imports_passed_through():
    from activities import contact_store

ACTIVITY_TIMEOUT = timedelta(seconds=10)
DEFAULT_RETRY_POLICY = RetryPolicy(maximum_attempts=5)
MAX_SIGNALS_PER_RUN = 200  # continue-as-new threshold


@workflow.defn
class ContactLoopWorkflow:
    """One long-running workflow per contact (`id=f"contact-loop:{contact_id}"`).

    Holds no durable business state in memory beyond the transient pending-
    signal queue — everything that must survive lives in `contact_state`/
    `tasks`/`interactions`, which is what makes `continue_as_new` trivial
    and safe (no accumulated state to carry forward or risk losing).
    """

    def __init__(self) -> None:
        """Initialize the transient pending-signal queue."""
        self._pending: list[SignalEnvelope] = []
        self._processed = 0

    @workflow.signal(name="signal_received")
    async def signal_received(self, envelope: SignalEnvelope) -> None:
        """Queue an inbound signal for processing by the run loop."""
        self._pending.append(envelope)

    @workflow.run
    async def run(self, input: ContactLoopInput) -> None:
        """Process signals for this contact until continue-as-new."""
        await workflow.execute_activity(
            contact_store.set_contact_workflow_id,
            contact_store.SetContactWorkflowIdInput(
                contact_id=input.contact_id, workflow_id=workflow.info().workflow_id
            ),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        while True:
            await workflow.wait_condition(lambda: bool(self._pending))
            envelope = self._pending.pop(0)
            await self._handle_signal(input, envelope)
            self._processed += 1
            if self._processed >= MAX_SIGNALS_PER_RUN and not self._pending:
                workflow.continue_as_new(input)

    async def _handle_signal(self, input: ContactLoopInput, envelope: SignalEnvelope) -> None:
        contact = await workflow.execute_activity(
            contact_store.get_contact,
            input.contact_id,
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        contact_state = await workflow.execute_activity(
            contact_store.get_or_create_contact_state,
            contact_store.GetOrCreateContactStateInput(contact_id=input.contact_id, org_id=input.org_id),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )
        consent = await workflow.execute_activity(
            contact_store.get_current_consent,
            contact_store.GetConsentInput(contact_id=input.contact_id, channel=envelope.channel),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )

        decision = evaluate(
            signal=envelope.signal,
            contact=contact,
            contact_state=contact_state,
            consent=consent,
            now=workflow.now(),
        )

        if decision.contact_state_patch:
            await workflow.execute_activity(
                contact_store.update_contact_state,
                contact_store.UpdateContactStateInput(contact_id=input.contact_id, patch=decision.contact_state_patch),
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=DEFAULT_RETRY_POLICY,
            )

        if decision.cancel_scheduled_follow_ups:
            await workflow.execute_activity(
                contact_store.cancel_scheduled_follow_ups,
                contact_store.CancelScheduledFollowUpsInput(contact_id=input.contact_id),
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=DEFAULT_RETRY_POLICY,
            )

        await workflow.execute_activity(
            contact_store.mark_signal_processed,
            str(envelope.signal.id),
            start_to_close_timeout=ACTIVITY_TIMEOUT,
            retry_policy=DEFAULT_RETRY_POLICY,
        )

        for proposed in decision.tasks:
            task = await workflow.execute_activity(
                contact_store.insert_task,
                contact_store.InsertTaskInput(
                    org_id=input.org_id,
                    contact_id=input.contact_id,
                    caused_by_signal_id=str(envelope.signal.id),
                    proposed=proposed,
                ),
                start_to_close_timeout=ACTIVITY_TIMEOUT,
                retry_policy=DEFAULT_RETRY_POLICY,
            )
            await workflow.start_child_workflow(
                "TaskExecutionWorkflow",
                TaskExecutionInput(task_id=str(task.id)),
                id=f"task-exec:{task.id}",
                parent_close_policy=ParentClosePolicy.ABANDON,
            )
