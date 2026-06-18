# Backend Setup

This guide provisions the four external services the Mirenta backend depends on and confirms each one answers before any implementation begins. Work top to bottom. Each step names the `.env` values it produces. When every value is filled, `pnpm preflight` pings all four services and reports a per-service pass or fail.

The four services come from the decision record: Supabase (Postgres, Auth, and the worker host), Anthropic (the agent sessions), Exa (search and fetch), and AWS S3 (the published sites). See `../DECISIONS.md` and `../mirenta-docs/technical/`.

## Prerequisites

- Node 22.18 or newer. Node runs the TypeScript preflight script directly through native type stripping, so the setup needs no build step or transpiler.
- pnpm 9 or newer.

```bash
cd mirenta-backend
pnpm install
cp .env.example .env
```

Fill `.env` as you complete each step below.

## 1. Supabase

Supabase supplies Postgres, Auth, and the worker host (a scheduled function paired with an edge function, per D32).

1. Create a project at https://supabase.com/dashboard.
2. Open Project Settings > API. Copy the Project URL into `SUPABASE_URL` and the project ref (the subdomain of that URL) into `SUPABASE_PROJECT_REF`.
3. From the same page, copy the `anon` public key into `SUPABASE_ANON_KEY` and the `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`. The service role key bypasses row-level security and belongs only to the server, never the client.
4. Open Project Settings > API > JWT Settings and copy the JWT secret into `SUPABASE_JWT_SECRET`. The gateway verifies seller sessions with it.
5. Open Project Settings > Database and copy the connection string into `SUPABASE_DB_URL`. Substitute the database password you set at project creation.

Produces: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_DB_URL`.

## 2. Anthropic

Anthropic runs both agents. The MVP calls the API in Realtime mode (D7) on Sonnet for research and Opus for the builder (D35).

1. Create an API key at https://console.anthropic.com/settings/keys and copy it into `ANTHROPIC_API_KEY`.
2. Leave `ANTHROPIC_RESEARCH_MODEL`, `ANTHROPIC_BUILDER_MODEL`, and `ANTHROPIC_API_MODE` at their defaults unless a model id changes.

Produces: `ANTHROPIC_API_KEY` (plus the three model and mode defaults).

## 3. Exa

Exa serves search and content fetch (D6). The research doc records the Exa credit budget as exhausted at the time of writing, so confirm the account holds credits before a real run.

1. Create an API key at https://dashboard.exa.ai/api-keys and copy it into `EXA_API_KEY`.
2. Confirm the account holds credits. Preflight reports HTTP 402 when credits run out.

Produces: `EXA_API_KEY` (with `EXA_BASE_URL` defaulted).

## 4. AWS S3

S3 hosts each published one-pager as a single public object at `{orgId}/{jobId}/index.html` (D16, D29).

1. Create a bucket in your chosen region. Set `AWS_REGION` and `S3_SITES_BUCKET`.
2. Enable static website hosting on the bucket and apply a public-read bucket policy. Copy the website endpoint into `S3_PUBLIC_BASE_URL`.
3. Create an IAM user with permission to put objects in that bucket. Copy its access key into `AWS_ACCESS_KEY_ID` and its secret into `AWS_SECRET_ACCESS_KEY`.

Produces: `AWS_REGION`, `S3_SITES_BUCKET`, `S3_PUBLIC_BASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

## 5. Worker and app config

These values configure the durability loop and the service. The defaults suit the MVP; set the secret.

- `WORKER_TRIGGER_SECRET`: a random string the scheduler presents to authenticate a worker tick. Generate one with `openssl rand -hex 32`.
- `MAX_JOB_ATTEMPTS`, `WORKER_LEASE_SECONDS`, `WORKER_CLAIM_BATCH_SIZE`, `PORT`, `LOG_LEVEL`, `NODE_ENV`: leave at the defaults unless you have reason to change them.

Produces: `WORKER_TRIGGER_SECRET` (the rest carry defaults).

## 6. Confirm

```bash
pnpm preflight
```

Preflight loads `.env`, confirms the required variables are present, then pings each service with the cheapest call that proves the credential works: a REST reachability check on Supabase, a one-token message on Anthropic, a one-result search on Exa, and a HeadBucket on S3. It prints a per-service pass or fail and exits nonzero when any service fails, so an implementation agent can tell a configuration problem apart from a code problem before spending a real pipeline run.

## What this setup deliberately leaves open

This directory holds only what provisions and verifies the external services. It does not choose the application's architecture. The framework, the module layout, the database client, the research-object types, the migrations, the test runner, and the agent integration all belong to the implementation phase. The preflight script stands alone and imposes none of them.
