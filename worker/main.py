"""Temporal worker entrypoint — registers workflows + activities, connects, runs.

Run via `make worker` (see Makefile).
"""

import asyncio

from temporalio.worker import Worker

from activities import channels, contact_store, interactions
from activities import logging as logging_activities
from app.core.config import settings
from app.core.logging import logger
from app.services.clients.temporal_client import get_temporal_client
from workflows.contact_loop import ContactLoopWorkflow
from workflows.task_execution import TaskExecutionWorkflow

ACTIVITIES = [
    contact_store.get_contact,
    contact_store.get_organization,
    contact_store.get_or_create_contact_state,
    contact_store.get_current_consent,
    contact_store.update_contact_state,
    contact_store.set_contact_workflow_id,
    contact_store.insert_task,
    contact_store.get_task,
    contact_store.update_task_status,
    contact_store.mark_signal_processed,
    contact_store.cancel_scheduled_follow_ups,
    interactions.run_interaction,
    channels.send_sms_message,
    channels.send_post_meeting_email,
    logging_activities.log_interaction,
    logging_activities.emit_interaction_result_signal,
]


async def main() -> None:
    """Connect to Temporal and run the worker until interrupted."""
    client = await get_temporal_client()
    worker = Worker(
        client,
        task_queue=settings.TEMPORAL_TASK_QUEUE,
        workflows=[ContactLoopWorkflow, TaskExecutionWorkflow],
        activities=ACTIVITIES,
    )
    logger.info(
        "temporal_worker_starting",
        task_queue=settings.TEMPORAL_TASK_QUEUE,
        environment=settings.ENVIRONMENT.value,
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
