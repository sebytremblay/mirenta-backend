-- 0011_grant_org_helpers_execute.sql
-- RLS policies call is_org_member / is_org_admin under the caller's role
-- (authenticated). Creating those helpers does not grant EXECUTE; newer
-- Supabase setups also revoke default PUBLIC execute. Without this grant,
-- dashboard org list/create fails with "permission denied for function
-- is_org_member" before membership can even be evaluated.

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;

grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;
