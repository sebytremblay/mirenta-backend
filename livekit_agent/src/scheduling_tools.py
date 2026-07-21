"""Calendar tools the voice agent calls during a live SIP call.

These are worker-native LiveKit ``function_tool``s rather than bindings of the
backend's ``app/agent_tools`` registry: this project is an isolated venv with no
``app`` package (and no LangChain), so the seam to Mirenta is HTTP — the same
pattern as ``bootstrap``/``finalize``. Each tool closes over the call's
``org_id``/``contact_id`` and delegates to :class:`MirentaVoiceClient`, which
posts to the internal voice endpoints. The LLM never sees correlation ids.

Three tools:

- ``get_availability`` — read-only; returns open slots for the agent to read out.
- ``capture_email`` — collapses a phonetically spelled address to a string in
  Python and stores it on the call's ``userdata`` slot, returning the canonical
  address for the agent to read back.
- ``schedule_meeting`` — the booking action; writes the calendar event and, as a
  built-in step, emails the caller a confirmation from the org's connected
  Google account. It reads the confirmation address from the ``userdata`` slot
  captured by ``capture_email`` — the LLM never hand-writes the email string, so
  the address the caller confirmed is exactly the address that gets booked.
"""

from __future__ import annotations

import logging
from typing import Any

from livekit.agents import RunContext, function_tool

from call_state import CallData, collapse_email
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
    async def get_availability(
        context: RunContext,
        weekdays: list[str] | None = None,
        duration_minutes: int | None = None,
        earliest_hour: int | None = None,
        latest_hour: int | None = None,
    ) -> str:
        """Look up open meeting times on the organization's calendar.

        Call this when the caller asks about availability or wants to book. If
        the caller named specific days ("Monday or Wednesday"), pass them in
        ``weekdays``; otherwise omit it to offer the soonest openings. By default
        this offers reasonable daytime hours. Pass ``earliest_hour`` /
        ``latest_hour`` (24-hour local time) whenever the caller asks about a
        specific time outside normal daytime — honor the literal hour they name,
        including late night and the small hours. Examples: "Tuesday at 6am" ->
        earliest_hour=6; "one or two in the morning" -> earliest_hour=1;
        "anything tonight from 9 on" -> earliest_hour=21 (the tool then runs to
        midnight); "sometime in the evening" -> latest_hour=21. Do not round a
        late or early request up to business hours.
        Meetings are 30 minutes by default; only pass ``duration_minutes`` if the
        caller asks for a longer meeting, up to 60 minutes. Read the returned
        times back conversationally and let the caller pick one.

        Args:
            weekdays: Optional weekday names to restrict to (e.g. ["monday"]).
            duration_minutes: Meeting length in minutes (30–60); omit for 30.
            earliest_hour: Earliest local start hour (0–23) if the caller names
                an early time; omit for the default daytime band.
            latest_hour: Latest local start hour (1–24) if the caller names a
                late time; omit for the default daytime band.
        """
        _ = context
        try:
            result = await mirenta.get_availability(
                org_id=org_id,
                contact_id=contact_id,
                weekdays=weekdays or [],
                duration_minutes=duration_minutes,
                earliest_hour=earliest_hour,
                latest_hour=latest_hour,
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
    async def capture_email(
        context: RunContext[CallData],
        local_part: list[str],
        domain: str,
    ) -> str:
        """Record the caller's email from its phonetic spelling, then read it back.

        Call this whenever the caller spells an email address. Pass the part
        before the "@" one token per character in ``local_part`` — a phonetic
        code word ("sierra"), a bare letter ("s"), or a spoken digit ("seven");
        drop separator words like "at" and "dot". Pass the part after the "@" as
        a normal word in ``domain`` ("gmail.com" or "gmail dot com"). This tool
        collapses those tokens to the address deterministically and stores it, so
        do not assemble the string yourself. Always read the returned address
        back to the caller to confirm before booking; if they correct it, call
        this tool again with the corrected spelling. Booking uses exactly this
        stored address, so what you confirm is what gets sent.

        Args:
            local_part: The pre-"@" characters, one spoken token each.
            domain: The post-"@" domain as a normal word (e.g. "gmail.com").
        """
        try:
            email = collapse_email(local_part, domain)
        except ValueError:
            logger.info("voice_tool_capture_email_empty org_id=%s", org_id)
            return "I did not catch that address. Could you spell it out one more time, letter by letter?"

        context.userdata.email = email
        logger.info("voice_tool_email_captured org_id=%s email=%s", org_id, email)
        spelled = ", ".join(email.split("@")[0])
        return (
            f"Stored the email as {email}. Read it back to the caller to confirm — "
            f'the part before the at sign is spelled "{spelled}". '
            f"If they correct it, call capture_email again."
        )

    @function_tool
    async def schedule_meeting(
        context: RunContext[CallData],
        start: str,
        end: str,
        location: str | None = None,
        notes: str | None = None,
    ) -> str:
        """Book a meeting the caller chose and email them a confirmation.

        Only call this after the caller confirms one of the times from
        ``get_availability`` and, if they want a confirmation email, after
        ``capture_email`` has stored and read back their address. Copy ``start``
        and ``end`` exactly from the chosen slot's booking reference. Use
        ``location`` for the meeting place (for example a listing address) when
        you know it. The confirmation goes to the address captured by
        ``capture_email`` (or the one on file if none was captured) — you do not
        pass the email here, which is what keeps the confirmed address and the
        sent address identical. Booking sends the confirmation itself; there is
        no separate step.

        Args:
            start: Chosen slot start, copied verbatim from get_availability.
            end: Chosen slot end, copied verbatim from get_availability.
            location: Meeting location as free text, when known.
            notes: Any extra context to include on the calendar event.
        """
        email = context.userdata.email
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

        context.userdata.booked_event_id = result.get("event_id")
        label = result.get("label") or "the selected time"
        if result.get("email_sent", False):
            return f"Booked for {label}. I just sent a confirmation email with the details."
        return (
            f"Booked for {label}. I could not send the confirmation email, so let the caller know and "
            f"offer to read the details back or confirm the address to use."
        )

    return [get_availability, capture_email, schedule_meeting]
