import { db, createOrganization, upsertProductProfile, createLeadBatch, insertLead, createJob, claimJobs, getJob } from "../src/db/client.ts";

const tag = `smoke-${Date.now()}`;
let orgId: string | null = null;

try {
  const org = await createOrganization(`Smoke Org ${tag}`, tag);
  orgId = org.id;
  console.log("org:", org.id);

  await upsertProductProfile({
    org_id: org.id,
    company_name: "Acme",
    product_name: "Widget",
    value_prop: "Ship faster",
  });
  console.log("profile upserted");

  const batch = await createLeadBatch(org.id, "smoke");
  const lead = await insertLead({
    org_id: org.id,
    batch_id: batch.id,
    first_name: "Test",
    last_name: "Lead",
    role: "VP",
    company: "Plexus",
    website_url: "https://plexus.com",
    email: `${tag}@example.com`,
    custom_fields: null,
  });
  console.log("lead:", lead.id);

  const job = await createJob({ org_id: org.id, lead_id: lead.id, batch_id: batch.id });
  console.log("job:", job.id, "status:", job.status, "attempts:", job.attempts);

  const claimed = await claimJobs(10, 300);
  const mine = claimed.find((j) => j.id === job.id);
  console.log("claimed count:", claimed.length, "| mine leased?", !!mine?.lease_until, "| attempts:", mine?.attempts);

  const reread = await getJob(org.id, job.id);
  console.log("reread status:", reread?.status, "lease_until set:", !!reread?.lease_until);

  console.log("SMOKE DB: PASS");
} catch (e) {
  console.error("SMOKE DB: FAIL", (e as Error).message);
  process.exitCode = 1;
} finally {
  if (orgId) {
    // Cascade deletes profile, batch, lead, job, research.
    await db().from("organizations").delete().eq("id", orgId);
    console.log("cleaned org", orgId);
  }
}
