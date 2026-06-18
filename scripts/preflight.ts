/**
 * Preflight: a standalone connectivity check for the four external services.
 *
 * Loads `.env`, confirms the required variables are present, then pings Supabase,
 * Anthropic, Exa, and AWS S3 with the real credentials. The implementation agent runs
 * `pnpm preflight` to confirm the world is reachable before a real pipeline run, and to
 * close its own loop without guessing whether a failure is its code or a bad key.
 *
 * This script is deliberately self-contained. It owns no application architecture: the
 * required-variable list below mirrors `.env.example`, nothing more. How the app loads
 * and validates config (a schema package, a framework's config layer, whatever) is the
 * implementation agent's decision.
 */
import { existsSync } from "node:fs";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

const ENV_FILE = new URL("../.env", import.meta.url).pathname;

/** Required keys, grouped by service. Mirrors `.env.example`. */
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_RESEARCH_MODEL",
  "EXA_API_KEY",
  "EXA_BASE_URL",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_SITES_BUCKET",
] as const;

interface ProbeResult {
  service: string;
  ok: boolean;
  detail: string;
}

async function probe(service: string, fn: () => Promise<string>): Promise<ProbeResult> {
  try {
    return { service, ok: true, detail: await fn() };
  } catch (err) {
    return { service, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Supabase: an unauthenticated GET to the REST root with the anon key proves URL + key. */
async function checkSupabase(): Promise<string> {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY! },
  });
  if (!res.ok && res.status !== 404) throw new Error(`REST root returned ${res.status}`);
  return `reachable (HTTP ${res.status})`;
}

/** Anthropic: a 1-token message is the cheapest call that validates the key. */
async function checkAnthropic(): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_RESEARCH_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!res.ok) throw new Error(`messages API returned ${res.status}: ${await res.text()}`);
  return "key valid";
}

/** Exa: a tiny search proves the key and that credits are available. */
async function checkExa(): Promise<string> {
  const res = await fetch(`${process.env.EXA_BASE_URL}/search`, {
    method: "POST",
    headers: { "x-api-key": process.env.EXA_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ query: "mirenta preflight", numResults: 1 }),
  });
  if (res.status === 401) throw new Error("invalid EXA_API_KEY");
  if (res.status === 402) throw new Error("Exa credits exhausted (HTTP 402)");
  if (!res.ok) throw new Error(`search returned ${res.status}: ${await res.text()}`);
  return "key valid, credits available";
}

/** S3: HeadBucket confirms the bucket exists and the IAM credentials reach it. */
async function checkS3(): Promise<string> {
  const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  await client.send(new HeadBucketCommand({ Bucket: process.env.S3_SITES_BUCKET }));
  return `bucket "${process.env.S3_SITES_BUCKET}" reachable in ${process.env.AWS_REGION}`;
}

async function main(): Promise<void> {
  if (!existsSync(ENV_FILE)) {
    console.error("No .env file found. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  process.loadEnvFile(ENV_FILE);

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env vars:\n${missing.map((k) => `  - ${k}`).join("\n")}`);
    process.exit(1);
  }

  console.log("Environment present. Probing services...\n");
  const results = await Promise.all([
    probe("Supabase", checkSupabase),
    probe("Anthropic", checkAnthropic),
    probe("Exa", checkExa),
    probe("S3", checkS3),
  ]);

  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.service.padEnd(10)} ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} service(s) failed preflight. Fix the above before a real run.`);
    process.exit(1);
  }
  console.log("\nAll services reachable. Ready for a pipeline run.");
}

void main();
