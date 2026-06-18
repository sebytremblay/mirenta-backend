// API Gateway. Verifies the caller, resolves the org_id server-side, and routes
// to the services (mvp-pipeline-architecture Service Topology, Auth and Tenancy).
// Built on Node's http module to keep the stack lean.
//
// Routes:
//   POST /profile           save the product profile (onboarding)
//   GET  /profile           read the product profile
//   POST /leads             submit leads, or regenerate one (D44)
//   GET  /jobs/{jobId}       poll one job's status
//   GET  /healthz           liveness
//
// Auth is two-tier (D18). The human path verifies a Supabase session and resolves
// the org from membership; the worker path holds an internal credential. The MVP
// resolves the org server-side and never trusts a client-asserted tenant. Until
// the frontend wires real Supabase sessions, the gateway accepts a verified
// bearer token (Supabase JWT) and falls back to a dev org header in non-production.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "../config/env.ts";
import { resolveOrgIdForUser } from "../db/client.ts";
import { verifyAccessToken } from "./auth.ts";
import {
  getProfile,
  saveProfile,
  ProfileValidationError,
} from "../services/personalization.ts";
import {
  jobStatus,
  submit,
  LeadNotFoundError,
  ProfileIncompleteError,
} from "../services/leads.ts";

interface Ctx {
  orgId: string;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

// Resolve the caller's org_id server-side. Order: a verified Supabase session
// (the human path), then, only outside production, a dev org header for local
// testing. The client never asserts the tenant on the production path.
async function resolveContext(req: IncomingMessage): Promise<Ctx> {
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const userId = await verifyAccessToken(token);
    if (!userId) throw new HttpError(401, "invalid session");
    const orgId = await resolveOrgIdForUser(userId);
    if (!orgId) throw new HttpError(403, "no organization for user");
    return { orgId };
  }

  // Dev fallback: an explicit org header, fail-closed behind an opt-in flag that
  // defaults off and never activates in production (config.gateway.allowDevOrgHeader).
  // Lets the pipeline run end to end before the frontend wires Supabase Auth.
  // The absence of a variable must never be what enables a tenant override.
  const devOrg = req.headers["x-mirenta-org"];
  if (config.gateway.allowDevOrgHeader && typeof devOrg === "string" && devOrg) {
    return { orgId: devOrg };
  }

  throw new HttpError(401, "missing or invalid authorization");
}

type Handler = (req: IncomingMessage, res: ServerResponse, ctx: Ctx, params: Record<string, string>) => Promise<void>;

const handlers: Array<{ method: string; pattern: RegExp; handler: Handler; auth: boolean }> = [
  {
    method: "POST",
    pattern: /^\/profile$/,
    auth: true,
    handler: async (req, res, ctx) => {
      const body = (await readJson(req)) as Record<string, unknown>;
      const profile = await saveProfile(ctx.orgId, body);
      send(res, 200, { profile });
    },
  },
  {
    method: "GET",
    pattern: /^\/profile$/,
    auth: true,
    handler: async (_req, res, ctx) => {
      const profile = await getProfile(ctx.orgId);
      if (!profile) return send(res, 404, { error: "no profile" });
      send(res, 200, { profile });
    },
  },
  {
    method: "POST",
    pattern: /^\/leads$/,
    auth: true,
    handler: async (req, res, ctx) => {
      const body = (await readJson(req)) as Record<string, unknown>;
      const result = await submit(ctx.orgId, body);
      send(res, 202, result);
    },
  },
  {
    method: "GET",
    pattern: /^\/jobs\/([0-9a-fA-F-]+)$/,
    auth: true,
    handler: async (_req, res, ctx, params) => {
      const view = await jobStatus(ctx.orgId, params.jobId!);
      if (!view) return send(res, 404, { error: "job not found" });
      send(res, 200, view);
    },
  },
];

function mapError(err: unknown): { status: number; body: unknown } {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
  if (err instanceof ProfileIncompleteError) {
    return { status: 422, body: { error: err.message, missing: err.missing } };
  }
  if (err instanceof ProfileValidationError) {
    return { status: 400, body: { error: err.message, missing: err.missing } };
  }
  if (err instanceof LeadNotFoundError) return { status: 404, body: { error: err.message } };
  const message = (err as Error).message ?? "internal error";
  return { status: 500, body: { error: message } };
}

export const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/healthz") {
      return send(res, 200, { ok: true });
    }

    const route = handlers.find(
      (h) => h.method === req.method && h.pattern.test(path),
    );
    if (!route) return send(res, 404, { error: "not found" });

    try {
      const ctx = route.auth ? await resolveContext(req) : { orgId: "" };
      const match = route.pattern.exec(path);
      // Named param: the first capture group on /jobs/{jobId}.
      const params: Record<string, string> = {};
      if (match && match[1]) params.jobId = match[1];
      await route.handler(req, res, ctx, params);
    } catch (err) {
      const { status, body } = mapError(err);
      send(res, status, body);
    }
  })();
});

// Start only when run directly, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(config.gateway.port, () => {
    console.log(`[gateway] listening on :${config.gateway.port}`);
  });
}
