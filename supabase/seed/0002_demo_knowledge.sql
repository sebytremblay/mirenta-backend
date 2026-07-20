-- 0002_demo_knowledge.sql
-- Demo knowledge base for the shared Mirenta Twilio number org (0001_demo_org.sql).

insert into knowledge (org_id, kind, title, content)
select
  o.id,
  k.kind::knowledge_kind,
  k.title,
  k.content
from organizations o
cross join (
  values
    (
      'booking',
      'How to book a showing',
      'Prospective renters can book a showing by texting a preferred day and time window, or by calling the office. We confirm within one business day. For same-day requests, ask them to call the office directly.'
    ),
    (
      'hours',
      'Office hours',
      'Open Monday–Friday 8:00am–5:00pm local time. Closed weekends and major holidays.'
    ),
    (
      'services',
      'Services',
      'We help with scheduling showings, appointment reminders, and general leasing questions over SMS. Application and lease decisions require speaking with a staff member.'
    ),
    (
      'faq',
      'Rescheduling and cancellations',
      'To reschedule or cancel, reply with the appointment date and the new preferred time. Please give at least 24 hours notice when possible.'
    )
) as k(kind, title, content)
where o.slug = 'mirenta';
