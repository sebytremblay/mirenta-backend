// The shared seed for the two-phase smoke chain. Phase one (smoke:research)
// builds the research prompt for this prospect; phase two (smoke:builder)
// renders the page for the SAME prospect from the research phase one produced.
// Both phases import this single seed, so they never describe different
// prospects and never drift out of sync.
import type { ProductProfile } from "../src/domain/entities.ts";

// The lead both phases target. The shape satisfies the research kickoff's
// Pick<Lead, ...> and the builder's structural lead input alike.
export const smokeLead = {
  first_name: "Finn",
  last_name: "Mallery",
  role: "Co-founder and CEO",
  company: "Origami",
  website_url: "https://www.origami.chat",
};

// The customer product profile both phases run against. The research kickoff
// reads only company_name, product_name, and value_prop; the builder needs the
// full profile, so the full object lives here and the research phase narrows it.
export const smokeProfile: ProductProfile = {
  org_id: "00000000-0000-0000-0000-000000000000",
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Turns a lead list into one hyper-personalized one-pager per founder, in their own language.",
  positioning:
    "Founder-to-founder outreach that reads the prospect's public trail and mirrors it back.",
  proof_points: [],
  cta_text: "Trade notes founder to founder",
  brand: { primary_color: "#1f6feb" },
  vertical: "sales_marketing",
  economics: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};
