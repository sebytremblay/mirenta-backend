import { db } from "../src/db/client.ts";

const probe = await db()
  .from("token_usage")
  .select("id", { count: "exact", head: true });
if (probe.error) {
  console.error("token_usage SELECT failed:", probe.error.message);
  process.exit(1);
}
console.log("token_usage reachable. total rows:", probe.count ?? 0);

const { data, error } = await db()
  .from("token_usage")
  .select("lead_id, job_id, agent, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, request_count, cost_usd, created_at")
  .order("created_at", { ascending: true });
if (error) {
  console.error("token_usage read failed:", error.message);
  process.exit(1);
}
const rows = data ?? [];
if (rows.length === 0) {
  console.log("\nNo telemetry rows yet. The table exists but no job has recorded usage.");
  process.exit(0);
}

interface Agg { research: number; builder: number; total: number; rows: number }
const perLead = new Map<string, Agg>();
for (const r of rows as Array<Record<string, any>>) {
  const a = perLead.get(r.lead_id) ?? { research: 0, builder: 0, total: 0, rows: 0 };
  const cost = Number(r.cost_usd);
  if (r.agent === "research") a.research += cost;
  if (r.agent === "builder") a.builder += cost;
  a.total += cost;
  a.rows += 1;
  perLead.set(r.lead_id, a);
}

console.log("\nPer-lead cost breakdown (USD):");
console.log("lead_id".padEnd(38), "research".padStart(12), "builder".padStart(12), "total".padStart(12), "rows".padStart(6));
for (const [leadId, a] of perLead) {
  console.log(
    leadId.padEnd(38),
    a.research.toFixed(6).padStart(12),
    a.builder.toFixed(6).padStart(12),
    a.total.toFixed(6).padStart(12),
    String(a.rows).padStart(6),
  );
}

console.log("\nRaw rows:");
for (const r of rows as Array<Record<string, any>>) {
  console.log(`  ${r.created_at} ${r.agent.padEnd(8)} ${r.model} in=${r.input_tokens} out=${r.output_tokens} cw=${r.cache_creation_tokens} cr=${r.cache_read_tokens} reqs=${r.request_count} $${Number(r.cost_usd).toFixed(6)}`);
}
