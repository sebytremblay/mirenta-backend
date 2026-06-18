// The research object: the contract the Research Agent produces and the Website
// Builder consumes. Shape mirrors mirenta-docs/technical/mvp-data-model.md
// (generic core plus a pluggable domain extension). The MVP ships the
// salesforce_employee_service extension and validates against it.

export interface Executive {
  name: string;
  title: string;
  owns: string;
  profile: string;
}

export interface Quote {
  text: string;
  speaker: string;
  source_url: string;
  verified: boolean;
}

export interface DomainPriority {
  domain: string;
  pov: string;
  why_now: string;
}

export interface RoiInputs {
  total_employees: number;
  it_staff: number; // flagged when estimated
  hr_staff: number; // flagged when estimated
  estimated: boolean;
}

export interface ResearchExtension {
  domains: string[]; // parameterized, e.g. ["HR", "ITSM"]
  priorities: DomainPriority[];
  roi_inputs: RoiInputs;
}

export interface ResearchAccount {
  summary: string;
  recent_moves: string[];
  self_description_language: string;
}

export interface ResearchObject {
  vertical: string; // "salesforce_employee_service" for the MVP
  account: ResearchAccount;
  executives: Executive[];
  quotes: Quote[];
  extension: ResearchExtension;
}

// The MVP one-pager template holds six executive slots and the two HR/ITSM
// domains (mvp-data-model.md). These are template parameters, not schema limits.
export const EXECUTIVE_SLOTS = 6;
export const MVP_VERTICAL = "salesforce_employee_service";
export const MVP_DOMAINS = ["HR", "ITSM"] as const;

// JSON Schema for the `emit_research` tool. The Research Agent finishes by
// calling this tool under a forced tool_choice, so the model returns
// schema-shaped JSON the Build stage consumes without parsing free text.
// Kept deliberately permissive (no min/max constraints the gateway may reject);
// validateResearch below enforces structure in code.
export const RESEARCH_TOOL_SCHEMA = {
  type: "object",
  properties: {
    vertical: { type: "string" },
    account: {
      type: "object",
      properties: {
        summary: { type: "string" },
        recent_moves: { type: "array", items: { type: "string" } },
        self_description_language: { type: "string" },
      },
      required: ["summary", "recent_moves", "self_description_language"],
    },
    executives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          owns: { type: "string" },
          profile: { type: "string" },
        },
        required: ["name", "title", "owns", "profile"],
      },
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          speaker: { type: "string" },
          source_url: { type: "string" },
          verified: { type: "boolean" },
        },
        required: ["text", "speaker", "source_url", "verified"],
      },
    },
    extension: {
      type: "object",
      properties: {
        domains: { type: "array", items: { type: "string" } },
        priorities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              domain: { type: "string" },
              pov: { type: "string" },
              why_now: { type: "string" },
            },
            required: ["domain", "pov", "why_now"],
          },
        },
        roi_inputs: {
          type: "object",
          properties: {
            total_employees: { type: "number" },
            it_staff: { type: "number" },
            hr_staff: { type: "number" },
            estimated: { type: "boolean" },
          },
          required: ["total_employees", "it_staff", "hr_staff", "estimated"],
        },
      },
      required: ["domains", "priorities", "roi_inputs"],
    },
  },
  required: ["vertical", "account", "executives", "quotes", "extension"],
} as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Structural validation in code. The research stage rejects a malformed object
// rather than persisting it (D36 keeps no quality bar, but a schema-valid object
// is still required before Build). Returns the normalized object or throws.
export function validateResearch(raw: unknown): ResearchObject {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("research payload is not an object");
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.vertical !== "string") throw new Error("research.vertical missing");

  const account = r.account as Record<string, unknown> | undefined;
  if (!account || typeof account.summary !== "string") {
    throw new Error("research.account.summary missing");
  }
  if (!isStringArray(account.recent_moves)) {
    throw new Error("research.account.recent_moves must be string[]");
  }
  if (typeof account.self_description_language !== "string") {
    throw new Error("research.account.self_description_language missing");
  }

  if (!Array.isArray(r.executives)) throw new Error("research.executives must be an array");
  const executives: Executive[] = r.executives.map((e, i) => {
    const exec = e as Record<string, unknown>;
    if (
      typeof exec.name !== "string" ||
      typeof exec.title !== "string" ||
      typeof exec.owns !== "string" ||
      typeof exec.profile !== "string"
    ) {
      throw new Error(`research.executives[${i}] malformed`);
    }
    return { name: exec.name, title: exec.title, owns: exec.owns, profile: exec.profile };
  });

  if (!Array.isArray(r.quotes)) throw new Error("research.quotes must be an array");
  const quotes: Quote[] = r.quotes.map((q, i) => {
    const quote = q as Record<string, unknown>;
    if (
      typeof quote.text !== "string" ||
      typeof quote.speaker !== "string" ||
      typeof quote.source_url !== "string"
    ) {
      throw new Error(`research.quotes[${i}] malformed`);
    }
    return {
      text: quote.text,
      speaker: quote.speaker,
      source_url: quote.source_url,
      verified: quote.verified === true,
    };
  });

  const ext = r.extension as Record<string, unknown> | undefined;
  if (!ext) throw new Error("research.extension missing");
  if (!isStringArray(ext.domains)) throw new Error("research.extension.domains must be string[]");
  if (!Array.isArray(ext.priorities)) {
    throw new Error("research.extension.priorities must be an array");
  }
  const priorities: DomainPriority[] = ext.priorities.map((p, i) => {
    const pri = p as Record<string, unknown>;
    if (
      typeof pri.domain !== "string" ||
      typeof pri.pov !== "string" ||
      typeof pri.why_now !== "string"
    ) {
      throw new Error(`research.extension.priorities[${i}] malformed`);
    }
    return { domain: pri.domain, pov: pri.pov, why_now: pri.why_now };
  });

  const roi = ext.roi_inputs as Record<string, unknown> | undefined;
  if (!roi || typeof roi.total_employees !== "number") {
    throw new Error("research.extension.roi_inputs.total_employees missing");
  }
  const roiInputs: RoiInputs = {
    total_employees: roi.total_employees,
    it_staff: typeof roi.it_staff === "number" ? roi.it_staff : 0,
    hr_staff: typeof roi.hr_staff === "number" ? roi.hr_staff : 0,
    estimated: roi.estimated === true,
  };

  return {
    vertical: r.vertical,
    account: {
      summary: account.summary,
      recent_moves: account.recent_moves,
      self_description_language: account.self_description_language,
    },
    executives,
    quotes,
    extension: { domains: ext.domains, priorities, roi_inputs: roiInputs },
  };
}
