# supabase/seed/

Demo/fixture data, applied after all migrations. Same numbering rule as `migrations/`: add new files, don't edit shipped ones.

Apply locally via the Supabase CLI's `supabase db reset` (runs migrations, then everything in this directory in filename order) — see `docs/getting-started.md` step 4 and `docs/database.md`. There's no `make` target for this; it's a direct CLI/SQL-editor step.

## What's here

- `0001_demo_org.sql` — upserts (`on conflict (slug) do update`) the `organizations` row for the shared Twilio number (`+18555784700`, slug `mirenta`). This is what makes the SMS webhook resolve an org at all before any real customer has their own number — `receive_twilio_sms` looks up the receiving org by `organizations.phone`. Idempotent by design; safe to re-run.
- `0002_demo_knowledge.sql` — inserts four `knowledge` rows (booking, hours, services, FAQ) scoped to that same org via a `where o.slug = 'mirenta'` join. Not idempotent (plain `insert`, no `on conflict`) — re-running duplicates rows.

If you add a new seed file, follow `0001`'s upsert pattern when the data needs to survive repeated `db reset` runs during dev.
