-- Disable RLS on the application tables for the MVP.
-- D30 defers row-level security: the MVP enforces tenant isolation in
-- application code (every query filters on org_id), and RLS lands as a
-- fast-follow (BACKLOG item 1). Supabase enables RLS by default with no
-- policies, which denies the backend credential everything, so disable it
-- explicitly to match the design intent. The backend is the only client of
-- this database; before external traffic, re-enable RLS and add policies.
alter table organizations    disable row level security;
alter table memberships      disable row level security;
alter table product_profiles disable row level security;
alter table lead_batches     disable row level security;
alter table leads            disable row level security;
alter table jobs             disable row level security;
alter table research         disable row level security;
