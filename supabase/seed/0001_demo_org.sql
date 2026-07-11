-- 0001_demo_org.sql
-- Seed the org that owns the static Twilio SMS number while it's shared
-- across all inbound traffic. `receive_twilio_sms` (app/api/routers/signals.py)
-- resolves the receiving org by `organizations.phone`, so this row is what
-- makes the webhook resolve at all. Once businesses provision their own
-- numbers, each gets its own `organizations.phone` instead of this one.

insert into organizations (name, slug, phone)
values ('Mirenta', 'mirenta', '+18555784700')
on conflict (slug) do update set phone = excluded.phone;
