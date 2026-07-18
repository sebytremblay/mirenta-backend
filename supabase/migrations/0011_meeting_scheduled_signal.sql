-- 0011_meeting_scheduled_signal.sql
-- Add the `meeting_scheduled` signal type.
--
-- Emitted by app/api/routers/voice.py::voice_schedule_meeting after a tour is
-- booked on the org's calendar. It re-enters the contact's ContactLoopWorkflow
-- so the deterministic decision engine can schedule a post-meeting SMS
-- follow-up (decision/rules.py::decide_on_meeting_scheduled) at meeting-end,
-- through the same durable task path as every other scheduled send.
--
-- `signal_type` is a Postgres enum; a new value must be added explicitly.

alter type signal_type add value if not exists 'meeting_scheduled';
