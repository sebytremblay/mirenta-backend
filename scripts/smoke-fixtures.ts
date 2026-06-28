// The shared seeds for the four-link smoke chain. Each link builds the prompt for
// one LLM stage and chains to the next through a /tmp artifact: strategist ->
// research -> designer -> builder, then render. Every link imports this single
// source and resolves the SAME scenario through selectScenario, so they never
// describe different prospects and never drift.
//
// The customer is ALWAYS Mirenta: every scenario markets Mirenta, our real
// product, to a lead. A scenario swaps only the lead, never the customer,
// because the smoke exists to exercise Mirenta's own outreach. Most leads are
// real founders from a recent Y Combinator batch (Fall 2025 or Winter 2026),
// verified against the YC company directory; "origami" keeps the original
// illustrative prospect the chain shipped against first. Swap leads with a flag
// (each script copies its prompt to the clipboard on its own, so no pbcopy pipe):
//   npm run --silent smoke:strategist -- --profile=menza
//   SMOKE_PROFILE=menza npm run --silent smoke:designer
// Pass the SAME key to every link so they all describe the same prospect.
import type { Lead, ProductProfile } from "../src/domain/entities.ts";

// A lead carries only the fields the research kickoff (Pick<Lead, ...>) and the
// builder's structural lead input read, so a scenario seed needs no more.
type SmokeLead = Pick<Lead, "first_name" | "last_name" | "role" | "company" | "website_url">;

export interface SmokeScenario {
  // The flag key that selects this scenario, surfaced in diagnostics.
  key: string;
  // A one-line human label for stderr.
  label: string;
  lead: SmokeLead;
}

// The one customer every scenario markets: Mirenta itself. The strategist now
// reads the lead and this profile to design the research plan and the value
// recipe per lead, so no vertical bucket shapes the brief. This is the real
// Mirenta product profile, unchanged from the original single-prospect seed.
export const smokeProfile: ProductProfile = {
  org_id: "00000000-0000-0000-0000-000000000000",
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Turns a lead list into one hyper-personalized one-pager per founder, in their own language.",
  positioning:
    "Founder-to-founder outreach that reads the prospect's public trail and mirrors it back.",
  proof_points: [],
  cta_text: "Book a demo",
  brand: { primary_color: "#1f6feb" },
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

// The leads Mirenta markets to, keyed by flag. Each is a real, current YC
// founder, verified against ycombinator.com. The first key is the default when
// no flag is set.
export const SMOKE_SCENARIOS: Record<string, SmokeScenario> = {
  // The original smoke seed, kept as an option. Finn Mallery at Origami
  // (origami.chat) is the prospect the chain shipped against first.
  origami: {
    key: "origami",
    label: "Mirenta -> Finn Mallery, Origami",
    lead: {
      first_name: "Finn",
      last_name: "Mallery",
      role: "Co-founder and CEO",
      company: "Origami",
      website_url: "https://www.origami.chat",
    },
  },

  // Parametric (YC Fall 2025): "Physical businesses that run themselves."
  parametric: {
    key: "parametric",
    label: "Mirenta -> Cody Swain, Parametric (YC F25)",
    lead: {
      first_name: "Cody",
      last_name: "Swain",
      role: "Co-founder and CEO",
      company: "Parametric",
      website_url: "https://parametric.company",
    },
  },

  // Menza (YC Winter 2026): "The AI data analyst for consumer brands."
  menza: {
    key: "menza",
    label: "Mirenta -> Qasim Munye, Menza (YC W26)",
    lead: {
      first_name: "Qasim",
      last_name: "Munye",
      role: "Co-founder and CEO",
      company: "Menza",
      website_url: "https://menza.ai",
    },
  },

  // SellRaze (YC Fall 2025): "The fastest way to sell online."
  sellraze: {
    key: "sellraze",
    label: "Mirenta -> Jeff Mao, SellRaze (YC F25)",
    lead: {
      first_name: "Jeff",
      last_name: "Mao",
      role: "Co-founder and CEO",
      company: "SellRaze",
      website_url: "https://sellraze.com",
    },
  },
};

// The default scenario when no flag is passed. Keeps the original prospect.
export const DEFAULT_SCENARIO_KEY = "origami";

// Parse the scenario key from `--profile=<key>`, `--profile <key>`, `-p <key>`,
// or the SMOKE_PROFILE env var, in that order of precedence. argv wins over env
// so a flag on the line overrides an exported default.
function readScenarioKey(argv: string[], env: NodeJS.ProcessEnv): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const next = argv[i + 1];
    if ((arg === "--profile" || arg === "-p") && next) return next;
    const match = /^--profile=(.+)$/.exec(arg);
    if (match && match[1]) return match[1];
  }
  return env.SMOKE_PROFILE || undefined;
}

// Resolve the scenario both phases run against. An unknown key fails loud with
// the list of valid keys rather than silently falling back to the default, so a
// typo never sends the two phases to different prospects.
export function selectScenario(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): SmokeScenario {
  const key = readScenarioKey(argv, env) ?? DEFAULT_SCENARIO_KEY;
  const scenario = SMOKE_SCENARIOS[key];
  if (!scenario) {
    const known = Object.keys(SMOKE_SCENARIOS).join(", ");
    throw new Error(`unknown smoke profile: ${key} (known: ${known})`);
  }
  return scenario;
}
