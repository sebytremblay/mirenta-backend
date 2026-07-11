-- 0010_secure_agent_views.sql
-- Lock down current_consent / contact_timeline: Postgres views are security
-- definer by default and bypass RLS on their underlying tables. These views
-- are service-role-only (agent runtime + FastAPI timeline route); clients must
-- not read them via the Data API with the anon/authenticated keys.

alter view current_consent set (security_invoker = true);
alter view contact_timeline set (security_invoker = true);

revoke all on current_consent from anon, authenticated, public;
revoke all on contact_timeline from anon, authenticated, public;

grant select on current_consent to service_role;
grant select on contact_timeline to service_role;
