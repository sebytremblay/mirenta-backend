import type { VerticalSpec } from "../verticals/index.ts";

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

export interface ResearchExtension {
  domains: string[];
  priorities: DomainPriority[];
  value_inputs: Record<string, number>;
  estimated: boolean;
}

export interface ResearchAccount {
  summary: string;
  recent_moves: string[];
  self_description_language: string;
}

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
  vertical: string;
  account: ResearchAccount;
  executives: Executive[];
  quotes: Quote[];
  extension: ResearchExtension;
  brand?: ProspectBrand;
}

export const EXECUTIVE_SLOTS = 6;

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
        value_inputs: { type: "object", additionalProperties: { type: "number" } },
        estimated: { type: "boolean" },
      },
      required: ["domains", "priorities", "value_inputs", "estimated"],
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

export class ResearchSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchSchemaError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function toNumericMap(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

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

export function validateResearch(raw: unknown, vertical: VerticalSpec): ResearchObject {
  try {
    return validateResearchInner(raw, vertical);
  } catch (err) {
    if (err instanceof ResearchSchemaError) throw err;
    throw new ResearchSchemaError((err as Error).message);
  }
}

function validateResearchInner(raw: unknown, vertical: VerticalSpec): ResearchObject {
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

  const value_inputs = toNumericMap(ext.value_inputs);
  const estimated = ext.estimated === true;
  vertical.validateInputs(value_inputs, estimated);

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
    extension: { domains: ext.domains, priorities, value_inputs, estimated },
    ...(brand ? { brand } : {}),
  };
}
