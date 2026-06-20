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

// The prospect's own visual identity, extracted by the Research Agent from the
// prospect site so the Website Builder renders a page that genuinely wears the
// prospect's brand (D48). Every field is optional: a thin or unreachable site
// yields a partial object, and the builder falls back token by token to the
// seller brand and then to house defaults. Colors are six-digit hex; logo and
// favicon are absolute https URLs (https avoids mixed-content on the public
// https page). The builder sanitizes font_family before it reaches the
// stylesheet, since the prospect site is untrusted input.
export interface ProspectBrand {
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  text_color?: string;
  font_family?: string;
  logo_url?: string;
  favicon_url?: string;
}

export interface ResearchObject {
  vertical: string; // "salesforce_employee_service" for the MVP
  account: ResearchAccount;
  executives: Executive[];
  quotes: Quote[];
  extension: ResearchExtension;
  brand?: ProspectBrand; // optional; absent when the site yields no usable brand
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
    brand: {
      type: "object",
      description:
        "The prospect company's own visual identity, read from their website: brand colors, primary font, and absolute URLs for their logo and favicon. Omit any field you cannot source confidently from the prospect site.",
      properties: {
        primary_color: { type: "string", description: "Primary brand color as #RRGGBB hex" },
        accent_color: { type: "string", description: "Secondary or accent color as #RRGGBB hex" },
        background_color: { type: "string", description: "Page background color as #RRGGBB hex" },
        text_color: { type: "string", description: "Body text color as #RRGGBB hex" },
        font_family: { type: "string", description: "Primary typeface name the site uses" },
        logo_url: { type: "string", description: "Absolute https URL to the prospect's logo image" },
        favicon_url: { type: "string", description: "Absolute https URL to the prospect's favicon" },
      },
    },
  },
  required: ["vertical", "account", "executives", "quotes", "extension"],
} as const;

// Thrown when a research payload fails structural validation. The worker treats
// this as a permanent failure (a retry repeats the same malformed output), so it
// classifies on instanceof rather than matching error-message text.
export class ResearchSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchSchemaError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// Normalize the optional prospect brand. This never throws: the brand is a
// best-effort enrichment, so a malformed field drops to undefined and the
// builder falls back rather than failing the whole research object (backlog #9
// keeps no quality gate). Colors must be six-digit hex; asset URLs must be
// https to avoid mixed-content on the public https page; font_family carries
// through trimmed and length-capped, and the builder sanitizes it for CSS.
function normalizeProspectBrand(raw: unknown): ProspectBrand | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const b = raw as Record<string, unknown>;
  const color = (v: unknown): string | undefined =>
    typeof v === "string" && HEX_COLOR.test(v) ? v : undefined;
  const httpsUrl = (v: unknown): string | undefined =>
    typeof v === "string" && /^https:\/\//.test(v) ? v : undefined;

  const brand: ProspectBrand = {};
  const primary = color(b.primary_color);
  if (primary) brand.primary_color = primary;
  const accent = color(b.accent_color);
  if (accent) brand.accent_color = accent;
  const background = color(b.background_color);
  if (background) brand.background_color = background;
  const text = color(b.text_color);
  if (text) brand.text_color = text;
  if (typeof b.font_family === "string" && b.font_family.trim() !== "") {
    brand.font_family = b.font_family.trim().slice(0, 120);
  }
  const logo = httpsUrl(b.logo_url);
  if (logo) brand.logo_url = logo;
  const favicon = httpsUrl(b.favicon_url);
  if (favicon) brand.favicon_url = favicon;

  return Object.keys(brand).length > 0 ? brand : undefined;
}

// Structural validation in code. The research stage rejects a malformed object
// rather than persisting it (D36 keeps no quality bar, but a schema-valid object
// is still required before Build). Returns the normalized object or throws a
// ResearchSchemaError, which the worker classifies as a permanent failure.
export function validateResearch(raw: unknown): ResearchObject {
  try {
    return validateResearchInner(raw);
  } catch (err) {
    if (err instanceof ResearchSchemaError) throw err;
    throw new ResearchSchemaError((err as Error).message);
  }
}

function validateResearchInner(raw: unknown): ResearchObject {
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

  const brand = normalizeProspectBrand(r.brand);

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
    ...(brand ? { brand } : {}),
  };
}
