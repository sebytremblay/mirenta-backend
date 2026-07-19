"""Calendar tools the voice agent calls during a live SIP call.

These are worker-native LiveKit ``function_tool``s rather than bindings of the
backend's ``app/agent_tools`` registry: this project is an isolated venv with no
``app`` package (and no LangChain), so the seam to Mirenta is HTTP — the same
pattern as ``bootstrap``/``finalize``. Each tool closes over the call's
``org_id``/``contact_id`` and delegates to :class:`MirentaVoiceClient`, which
posts to the internal voice endpoints. The LLM never sees correlation ids.

Two tools, mirroring the read-only vs. mutating split in the backend registry:

- ``get_availability`` — read-only; returns open slots for the agent to read out.
- ``schedule_meeting`` — the booking action; writes the calendar event and, as a
  built-in step, emails the caller a confirmation from the org's connected
  Google account. There is no separate email tool: the agent captures the
  caller's email and passes it to ``schedule_meeting``.
"""

from __future__ import annotations

import logging
from typing import Any

from livekit.agents import RunContext, function_tool

from mirenta_client import MirentaVoiceClient

logger = logging.getLogger("mirenta-voice")

# Cap how many slots the agent reads aloud in one turn — the endpoint already
# bounds the list, but a spoken menu should stay short.
_MAX_SPOKEN_SLOTS = 5


def build_scheduling_tools(
    *,
    mirenta: MirentaVoiceClient,
    org_id: str,
    contact_id: str,
) -> list[Any]:
    """Build the calendar tool list bound to one call's context.

    Args:
        mirenta: HTTP client to the Mirenta internal voice endpoints.
        org_id: The organization whose calendar is being scheduled.
        contact_id: The caller, used backend-side to resolve their phone number.

    Returns:
        list: LiveKit ``function_tool``s to pass as ``Agent(tools=...)``.
    """

    @function_tool
    async def get_availability(context: RunContext, weekdays: list[str] | None = None) -> str:
        """Look up open meeting times on the organization's calendar.

        Call this when the caller asks about availability or wants to book. If
        the caller named specific days ("Monday or Wednesday"), pass them in
        ``weekdays``; otherwise omit it to offer the soonest openings. Read the
        returned times back conversationally and let the caller pick one.

        Args:
            weekdays: Optional weekday names to restrict to (e.g. ["monday"]).
        """
        _ = context
        try:
            result = await mirenta.get_availability(
                org_id=org_id,
                contact_id=contact_id,
                weekdays=weekdays or [],
            )
        except Exception:
            logger.exception("voice_tool_get_availability_failed org_id=%s", org_id)
            return "I could not reach the calendar just now. I can take a message instead."

        if not result.get("connected", False):
            return "The calendar is not connected yet, so I cannot check live availability. I can take a message."

        slots = result.get("slots", [])
        if not slots:
            return "I do not see any open times in the next several business days for those preferences."

        offered = slots[:_MAX_SPOKEN_SLOTS]
        labels = [slot["label"] for slot in offered]
        # The model needs the ISO bounds to book, but should speak the labels.
        machine = "; ".join(f"{slot['label']} => start={slot['start']} end={slot['end']}" for slot in offered)
        return (
            f"Open times: {', '.join(labels)}. "
            f"When the caller picks one, call schedule_meeting with the exact start and end from this list. "
            f"(booking references — {machine})"
        )

    @function_tool
    async def schedule_meeting(
        context: RunContext,
        start: str,
        end: str,
        location: str | None = None,
        notes: str | None = None,
        email: str | None = None,
    ) -> str:
        """Book a meeting the caller chose and email them a confirmation.

        Only call this after the caller confirms one of the times from
        ``get_availability``. Copy ``start`` and ``end`` exactly from the chosen
        slot's booking reference. Use ``location`` for the meeting place (for
        example a listing address) when you know it. Ask the caller for the email
        address where they want the confirmation and pass it in ``email`` (read
        it back first to be sure); omit it to use the email already on file.
        Booking sends the confirmation email itself — there is no separate step.

        Args:
            start: Chosen slot start, copied verbatim from get_availability.
            end: Chosen slot end, copied verbatim from get_availability.
            location: Meeting location as free text, when known.
            notes: Any extra context to include on the calendar event.
            email: Caller's email for the confirmation; omit to use the one on file.
        """
        _ = context
        try:
            result = await mirenta.schedule_meeting(
                org_id=org_id,
                contact_id=contact_id,
                start=start,
                end=end,
                location=location,
                notes=notes,
                email=email,
            )
        except Exception:
            logger.exception("voice_tool_schedule_meeting_failed org_id=%s", org_id)
            return "I hit a problem booking that time. Let me take your details and have someone follow up."

        if not result.get("connected", False):
            return "The calendar is not connected, so I cannot book that. I can take a message instead."
        if not result.get("booked", False):
            return "I was not able to book that time. Could we try another one?"

        label = result.get("label") or "the selected time"
        if result.get("email_sent", False):
            return f"Booked for {label}. I just sent a confirmation email with the details."
        return (
            f"Booked for {label}. I could not send the confirmation email, so let the caller know and "
            f"offer to read the details back or confirm the address to use."
        )

    return [get_availability, schedule_meeting]
