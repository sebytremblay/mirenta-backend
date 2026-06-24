import type { VerticalSpec } from "../verticals/index.ts";

export type AuthorityTier = "self" | "backer" | "tribe";

export const AUTHORITY_TIERS: readonly AuthorityTier[] = ["self", "backer", "tribe"];

// A respected voice couples the person and their verified words because, for a
// founder, the two are one artifact. `tier` is required and explicit so the
// builder renders the tier it received and never papers over an empty result.
export interface RespectedVoice {
  name: string; // the person quoted
  identity: string; // who they are relative to the founder: "Partner at First Round", "the founder", a domain figure
  tier: AuthorityTier; // required and explicit
  quote: { text: string; source_url: string; verified: boolean };
}

export interface DomainPriority {
  domain: string;
  pov: string;
  why_now: string;
}

export interface ResearchExtension {
  domains: string[];
  priorities: DomainPriority[];
  // Numeric signals a vertical's compute reads. Narrowed per vertical.
  value_inputs: Record<string, number>;
  // Open per-vertical categorical signals (a stage band for one vertical, a
  // go-to-market motion for another). Each vertical's validateInputs narrows
  // `context` to the keys it needs, exactly as it narrows value_inputs.
  context: Record<string, string>;
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
  voices: RespectedVoice[];
  extension: ResearchExtension;
  brand?: ProspectBrand;
}

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
    voices: {
      type: "array",
      description:
        "The founder's respected voices across the self/backer/tribe ladder, each carrying its verified quote inline. Return only voices whose quote you re-fetched and confirmed. An empty array is valid when the founder leaves no public trail.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The person quoted" },
          identity: {
            type: "string",
            description:
              "Who they are relative to the founder: \"the founder\", \"Partner at First Round\", a domain figure",
          },
          tier: {
            type: "string",
            enum: ["self", "backer", "tribe"],
            description:
              "self (the founder's own words), backer (an investor or angel who funded them), or tribe (a widely revered voice of the founder's domain)",
          },
          quote: {
            type: "object",
            properties: {
              text: { type: "string" },
              source_url: { type: "string" },
              verified: { type: "boolean" },
            },
            required: ["text", "source_url", "verified"],
          },
        },
        required: ["name", "identity", "tier", "quote"],
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
        context: {
          type: "object",
          description:
            "Vertical-named categorical signals (for example a stage band or a go-to-market motion). Fill the keys the vertical's guidance names. Leave empty when the vertical names none.",
          additionalProperties: { type: "string" },
        },
        estimated: { type: "boolean" },
      },
      required: ["domains", "priorities", "value_inputs", "context", "estimated"],
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
  required: ["vertical", "account", "voices", "extension"],
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

function toStringMap(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

function isAuthorityTier(value: unknown): value is AuthorityTier {
  return value === "self" || value === "backer" || value === "tribe";
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

  if (!Array.isArray(r.voices)) throw new Error("research.voices must be an array");
  const voices: RespectedVoice[] = r.voices.map((v, i) => {
    const voice = v as Record<string, unknown>;
    if (
      typeof voice.name !== "string" ||
      typeof voice.identity !== "string" ||
      !isAuthorityTier(voice.tier)
    ) {
      throw new Error(`research.voices[${i}] malformed`);
    }
    const quote = voice.quote as Record<string, unknown> | undefined;
    if (
      !quote ||
      typeof quote.text !== "string" ||
      typeof quote.source_url !== "string"
    ) {
      throw new Error(`research.voices[${i}].quote malformed`);
    }
    return {
      name: voice.name,
      identity: voice.identity,
      tier: voice.tier,
      quote: {
        text: quote.text,
        source_url: quote.source_url,
        verified: quote.verified === true,
      },
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
  const context = toStringMap(ext.context);
  const estimated = ext.estimated === true;
  vertical.validateInputs(value_inputs, estimated, context);

  const brand = normalizeProspectBrand(r.brand);

  return {
    vertical: r.vertical,
    account: {
      summary: account.summary,
      recent_moves: account.recent_moves,
      self_description_language: account.self_description_language,
    },
    voices,
    extension: { domains: ext.domains, priorities, value_inputs, context, estimated },
    ...(brand ? { brand } : {}),
  };
}
