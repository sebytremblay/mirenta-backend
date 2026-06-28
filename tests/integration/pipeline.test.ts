import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, createOrganization, createJob, claimJobs, updateJob, getJob } from "../../src/db/client.ts";
import { saveProfile } from "../../src/services/personalization.ts";
import { submit, jobStatus } from "../../src/services/leads.ts";
import { server } from "../../src/gateway/server.ts";
import type { AddressInfo } from "node:net";

let orgId: string;
let baseUrl: string;

before(async () => {
  const org = await createOrganization(`itest-${Date.now()}`, `itest-${Date.now()}`);
  orgId = org.id;
  await saveProfile(orgId, {
    company_name: "Salesforce",
    product_name: "Agentforce",
    value_prop: "Deflect support volume",
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (orgId) await db().from("organizations").delete().eq("id", orgId);
});

test("claim_jobs leases a pending job and bumps attempts", async () => {
  const lead = await db()
    .from("leads")
    .insert({ org_id: orgId, first_name: "A", last_name: "B", company: "Co" })
    .select()
    .single();
  const job = await createJob({ org_id: orgId, lead_id: lead.data!.id, batch_id: null });

  const claimed = await claimJobs(10, 300);
  const mine = claimed.find((j) => j.id === job.id);
  assert.ok(mine, "claim returns the pending job");
  assert.equal(mine!.attempts, 1, "attempts incremented by the claim");
  assert.ok(mine!.lease_until, "lease set");

  const second = await claimJobs(10, 300);
  assert.equal(second.find((j) => j.id === job.id), undefined, "leased job skipped");
});

test("guarded transition advances only from the expected status", async () => {
  const lead = await db()
    .from("leads")
    .insert({ org_id: orgId, first_name: "C", last_name: "D", company: "Co" })
    .select()
    .single();
  const job = await createJob({ org_id: orgId, lead_id: lead.data!.id, batch_id: null });

  const wrong = await updateJob(job.id, "building", { status: "done" });
  assert.equal(wrong, null, "transition from a non-matching status does nothing");
  assert.equal((await getJob(orgId, job.id))!.status, "pending");

  const right = await updateJob(job.id, "pending", { status: "researching" });
  assert.ok(right, "transition from the matching status applies");
  assert.equal((await getJob(orgId, job.id))!.status, "researching");
});

test("the four-stage status ladder advances only one guarded step at a time", async () => {
  const lead = await db()
    .from("leads")
    .insert({ org_id: orgId, first_name: "Q", last_name: "R", company: "Co" })
    .select()
    .single();
  const job = await createJob({ org_id: orgId, lead_id: lead.data!.id, batch_id: null });

  // Walk the full ladder the worker drives: pending -> planning -> researching
  // -> designing -> building -> done. Each step persists its stage artifact, and
  // the guard refuses to skip a stage, so a stale tick can never jump the ladder.
  const ladder: { from: typeof job.status; to: typeof job.status; patch: Record<string, unknown> }[] = [
    { from: "pending", to: "planning", patch: {} },
    { from: "planning", to: "researching", patch: { strategy: { plan: {}, recipe: {} } } },
    { from: "researching", to: "designing", patch: {} },
    { from: "designing", to: "building", patch: { page_spec: { sections: [] } } },
    { from: "building", to: "done", patch: { site_url: "http://example.com/p" } },
  ];

  for (const step of ladder) {
    // A guard from the wrong prior status does nothing.
    const skipped = await updateJob(job.id, "done", { status: step.to });
    assert.equal(skipped, null, `cannot reach ${step.to} from done`);

    const moved = await updateJob(job.id, step.from, { status: step.to, ...step.patch });
    assert.ok(moved, `advance ${step.from} -> ${step.to}`);
    assert.equal((await getJob(orgId, job.id))!.status, step.to);
  }

  const final = await getJob(orgId, job.id);
  assert.ok(final!.strategy, "the strategy artifact persisted across the ladder");
  assert.ok(final!.page_spec, "the page spec artifact persisted across the ladder");
});

test("submission-time dedupe reuses a job for the same email without orphaning a lead", async () => {
  const email = `dupe-${Date.now()}@plexus.com`;
  const first = await submit(orgId, {
    leads: [{ first_name: "E", last_name: "F", company: "Plexus", email }],
  });
  const second = await submit(orgId, {
    leads: [{ first_name: "E", last_name: "F", company: "Plexus", email }],
  });
  const [firstLead, firstJob] = Object.entries(first.map)[0]!;
  const [secondLead, secondJob] = Object.entries(second.map)[0]!;
  assert.equal(secondJob, firstJob, "the second submit reuses the first job");
  assert.equal(secondLead, firstLead, "dedupe maps the existing lead, no orphan");

  const leads = await db().from("leads").select("id").eq("org_id", orgId).eq("email", email);
  assert.equal(leads.data!.length, 1, "exactly one lead row exists for the deduped email");
});

test("regenerate forces a fresh job bypassing dedupe", async () => {
  const email = `regen-${Date.now()}@plexus.com`;
  const first = await submit(orgId, {
    leads: [{ first_name: "G", last_name: "H", company: "Plexus", email }],
  });
  const [leadId, firstJob] = Object.entries(first.map)[0]!;
  const regen = await submit(orgId, { regenerate: true, lead_id: leadId });
  const regenJob = regen.map[leadId];
  assert.ok(regenJob, "regenerate returns a job for the lead");
  assert.notEqual(regenJob, firstJob, "regenerate creates a fresh job");
});

test("gateway rejects an unauthenticated request", async () => {
  const res = await fetch(`${baseUrl}/profile`);
  assert.equal(res.status, 401);
});

test("gateway resolves the dev org header and serves the profile", async () => {
  const res = await fetch(`${baseUrl}/profile`, { headers: { "x-mirenta-org": orgId } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { profile: { company_name: string } };
  assert.equal(body.profile.company_name, "Salesforce");
});

test("gateway returns the leadId to jobId map on submit", async () => {
  const res = await fetch(`${baseUrl}/leads`, {
    method: "POST",
    headers: { "x-mirenta-org": orgId, "Content-Type": "application/json" },
    body: JSON.stringify({
      leads: [{ first_name: "I", last_name: "J", company: "Plexus", email: `gw-${Date.now()}@x.com` }],
    }),
  });
  assert.equal(res.status, 202);
  const body = (await res.json()) as { batchId: string; map: Record<string, string> };
  assert.ok(body.batchId);
  assert.equal(Object.keys(body.map).length, 1);
});

test("gateway 422 when the profile is incomplete", async () => {
  const bare = await createOrganization(`bare-${Date.now()}`, `bare-${Date.now()}`);
  try {
    const res = await fetch(`${baseUrl}/leads`, {
      method: "POST",
      headers: { "x-mirenta-org": bare.id, "Content-Type": "application/json" },
      body: JSON.stringify({ leads: [{ first_name: "K", last_name: "L", company: "Co" }] }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { missing: string[] };
    assert.ok(body.missing.includes("company_name"));
  } finally {
    await db().from("organizations").delete().eq("id", bare.id);
  }
});

test("jobStatus reflects a completed job with its url", async () => {
  const lead = await db()
    .from("leads")
    .insert({ org_id: orgId, first_name: "M", last_name: "N", company: "Co" })
    .select()
    .single();
  const job = await createJob({ org_id: orgId, lead_id: lead.data!.id, batch_id: null });
  await db()
    .from("jobs")
    .update({ status: "done", site_url: "http://example.com/site" })
    .eq("id", job.id);
  const view = await jobStatus(orgId, job.id);
  assert.equal(view!.status, "done");
  assert.equal(view!.url, "http://example.com/site");
});
