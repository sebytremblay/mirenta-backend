import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, "..", "..");

// Drop the dev shell's ambient Anthropic credentials before loading .env.
// loadEnvFile leaves already-present keys untouched, so an ambient
// ANTHROPIC_API_KEY (plus ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL) would
// shadow the real first-party key in .env and the SDK would inherit them at
// construction even though the clients pass apiKey + baseURL explicitly.
const ambientAnthropicKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_BASE_URL;

// A missing file is fine; rethrow any other error so a permission or parse
// failure fails loud at startup rather than starting with a half-loaded config.
try {
  process.loadEnvFile(resolve(backendRoot, ".env"));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

// Deploy fallback: when .env carries no key, restore the ambient key cleared above.
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
    readonly strategistModel: string;
    readonly researchModel: string;
    readonly designerModel: string;
    readonly builderModel: string;
    readonly apiMode: string;
  };
  readonly managedAgents: {
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
    // Read the backend-namespaced override, never the ambient ANTHROPIC_BASE_URL:
    // the dev shell points that at a browser-auth gateway that 401s the Managed
    // Agents endpoints.
    baseUrl: optional("MIRENTA_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
    // The two planning stages run on Opus: compact structured outputs where
    // judgment matters and token volume stays small.
    strategistModel: optional("ANTHROPIC_STRATEGIST_MODEL", "claude-opus-4-8"),
    designerModel: optional("ANTHROPIC_DESIGNER_MODEL", "claude-opus-4-8"),
    // researchModel bakes onto the persistent Managed Agents agent at
    // provisioning time, so changing it here requires re-running
    // scripts/provision-managed-agents.ts; the live agent keeps its old model
    // until then. builderModel reads at runtime, so it takes effect next build.
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
    // The worker holds the research session open synchronously within a tick, so
    // the lease must exceed worst-case research plus build runtime, and stay well
    // above the research timeout (leaseSeconds-60 in research.ts), or a second
    // tick re-claims the job mid-run and starts a duplicate session.
    leaseSeconds: intOptional("WORKER_LEASE_SECONDS", 900),
    pollIntervalMs: intOptional("WORKER_POLL_INTERVAL_MS", 5000),
  },
  agents: {
    builderMaxTokens: intOptional("BUILDER_MAX_TOKENS", 16000),
  },
  gateway: {
    port: intOptional("PORT", 8080),
    allowDevOrgHeader:
      boolOptional("MIRENTA_ALLOW_DEV_ORG_HEADER", false) &&
      process.env.NODE_ENV !== "production",
  },
});
