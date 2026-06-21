// Centralized configuration. Loads .env once, validates the required keys, and
// exposes a typed, frozen config object. Every module reads config from here
// rather than touching process.env directly, so a missing key fails loudly at
// startup instead of deep inside a stage.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, "..", "..");

// Neutralize the dev shell's ambient Anthropic gateway credentials BEFORE loading
// .env. The shell exports a Bedrock/gateway ANTHROPIC_API_KEY (plus
// ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL) because Claude Code runs on
// Bedrock. loadEnvFile (below) leaves keys already present in process.env
// untouched, so those ambient values would shadow the real first-party key in
// .env and 401 the Managed Agents calls. The project authenticates with the
// first-party key via x-api-key and pins the host through
// MIRENTA_ANTHROPIC_BASE_URL (D50), so the ambient auth token and base url are
// pure leak vectors: the SDK would inherit them at construction even though the
// clients pass apiKey + baseURL explicitly. Drop all three here.
//
// Deploy safety: keep the ambient ANTHROPIC_API_KEY as a fallback and restore it
// after the load only if .env did not supply one, so a platform that sets the
// key as an env var with no .env file (the normal deploy shape) still works.
// The auth token and base url are never restored: nothing in the project reads
// them. See [[mirenta-ambient-anthropic-key-leak]].
const ambientAnthropicKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_BASE_URL;

// Load .env through the Node built-in (the >=22.18 engines floor pins it well
// past its 20.12 introduction). Node needs no separate dotenv dependency and
// the project keeps deps lean. loadEnvFile leaves keys already present in
// process.env untouched, so ambient values win and deploys override the file
// (except the Anthropic credentials cleared above). A missing file is fine;
// rethrow any other error so a permission or parse failure fails loud at startup
// rather than starting with a half-loaded config.
try {
  process.loadEnvFile(resolve(backendRoot, ".env"));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

// Deploy fallback: .env wins, but when it carries no key, fall back to the
// platform-set ambient key the load cleared above.
if (!process.env.ANTHROPIC_API_KEY && ambientAnthropicKey) {
  process.env.ANTHROPIC_API_KEY = ambientAnthropicKey;
}

function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function intOptional(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${value}`);
  }
  return parsed;
}

export interface Config {
  readonly anthropic: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly researchModel: string;
    readonly builderModel: string;
    readonly apiMode: string;
  };
  readonly managedAgents: {
    // Persistent Managed Agents resources, provisioned once by
    // scripts/provision-managed-agents.ts and referenced by id at runtime (D50).
    readonly environmentId: string;
    readonly researchAgentId: string;
    readonly exaVaultId: string;
    readonly exaMcpUrl: string;
  };
  readonly exa: {
    readonly apiKey: string;
    readonly baseUrl: string;
  };
  readonly supabase: {
    readonly url: string;
    readonly key: string;
  };
  readonly s3: {
    readonly bucket: string;
    readonly region: string;
    readonly websiteEndpoint: string;
  };
  readonly worker: {
    readonly maxJobAttempts: number;
    readonly claimBatchSize: number;
    readonly leaseSeconds: number;
    readonly pollIntervalMs: number;
  };
  readonly agents: {
    readonly builderMaxTokens: number;
  };
  readonly gateway: {
    readonly port: number;
    // Fail-closed dev escape hatch: honor the x-mirenta-org header only when this
    // flag is explicitly on AND the environment is non-production.
    readonly allowDevOrgHeader: boolean;
  };
}

function boolOptional(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

// The S3 website endpoint follows the region-specific S3 static-hosting form.
// us-east-1 uses a hyphen-less host; every other region uses the dotted form.
function s3WebsiteEndpoint(bucket: string, region: string): string {
  const explicit = process.env.S3_WEBSITE_ENDPOINT;
  if (explicit) return explicit.replace(/\/$/, "");
  const host =
    region === "us-east-1"
      ? `${bucket}.s3-website-us-east-1.amazonaws.com`
      : `${bucket}.s3-website-${region}.amazonaws.com`;
  return `http://${host}`;
}

const s3Bucket = optional("S3_BUCKET", "mirenta-mvp");
const s3Region = optional("AWS_REGION", optional("S3_REGION", "us-west-1"));

export const config: Config = Object.freeze({
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    // Pin to the first-party Anthropic API. The dev shell exports a Salesforce
    // gateway URL in ANTHROPIC_BASE_URL (plus an ANTHROPIC_AUTH_TOKEN) that the
    // SDK inherits from the ambient environment by default. That gateway is a
    // browser-auth proxy that 401s the Managed Agents endpoints, which is what
    // misled a prior session into declaring Managed Agents unreachable (D45).
    // We deliberately do NOT read ANTHROPIC_BASE_URL: a backend-namespaced
    // MIRENTA_ANTHROPIC_BASE_URL override exists for a real proxy, and the
    // polluting shell does not set it. See D50 and [[mirenta-managed-agents-reachable]].
    baseUrl: optional("MIRENTA_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
    // Models pin to the dated Haiku id for the build (D47), set by the founder
    // to avoid burning tokens before the system proves out end to end.
    // researchModel bakes onto the PERSISTENT Managed Agents agent at
    // provisioning time, so changing it here requires re-running
    // scripts/provision-managed-agents.ts to take effect; the live agent keeps
    // its old model until then. builderModel reads at runtime, so it takes
    // effect on the next build. Restoring the D35 tiers is config plus a
    // re-provision for research, config alone for the builder.
    researchModel: optional("ANTHROPIC_RESEARCH_MODEL", "claude-haiku-4-5-20251001"),
    builderModel: optional("ANTHROPIC_BUILDER_MODEL", "claude-haiku-4-5-20251001"),
    apiMode: optional("ANTHROPIC_API_MODE", "realtime"),
  },
  managedAgents: {
    environmentId: optional("ANTHROPIC_ENVIRONMENT_ID", ""),
    researchAgentId: optional("ANTHROPIC_RESEARCH_AGENT_ID", ""),
    exaVaultId: optional("ANTHROPIC_EXA_VAULT_ID", ""),
    exaMcpUrl: optional("EXA_MCP_URL", "https://mcp.exa.ai/mcp"),
  },
  exa: {
    apiKey: required("EXA_API_KEY"),
    baseUrl: optional("EXA_BASE_URL", "https://api.exa.ai").replace(/\/$/, ""),
  },
  supabase: {
    url: required("SUPABASE_URL"),
    // Service-role key bypasses RLS for the worker; the publishable/anon key
    // also works while RLS stays off (D30). Either satisfies SUPABASE_KEY.
    key: required("SUPABASE_KEY"),
  },
  s3: {
    bucket: s3Bucket,
    region: s3Region,
    websiteEndpoint: s3WebsiteEndpoint(s3Bucket, s3Region),
  },
  worker: {
    maxJobAttempts: intOptional("MAX_JOB_ATTEMPTS", 5),
    claimBatchSize: intOptional("WORKER_CLAIM_BATCH_SIZE", 10),
    // The worker holds the research Managed Agents session open synchronously
    // within a tick (D50), so the lease must exceed the worst-case research plus
    // build runtime. Set it well above the research timeout
    // (leaseSeconds-60 in research.ts) so a second tick never re-claims a job
    // mid-run and starts a duplicate session.
    leaseSeconds: intOptional("WORKER_LEASE_SECONDS", 900),
    pollIntervalMs: intOptional("WORKER_POLL_INTERVAL_MS", 5000),
  },
  agents: {
    // The builder now emits the entire self-contained HTML document, not just
    // prose the assembler welds in (D9). The gold sample runs near 30KB, so the
    // ceiling rises well past the old prose-only 8000. 16000 covers a succinct
    // sample-grade page with headroom; raise it via the env var if pages truncate
    // (the builder treats a max_tokens stop as a transient, lease-retried fault).
    builderMaxTokens: intOptional("BUILDER_MAX_TOKENS", 16000),
  },
  gateway: {
    port: intOptional("PORT", 8080),
    allowDevOrgHeader:
      boolOptional("MIRENTA_ALLOW_DEV_ORG_HEADER", false) &&
      process.env.NODE_ENV !== "production",
  },
});
