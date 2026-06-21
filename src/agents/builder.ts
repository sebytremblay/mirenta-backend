// Website Builder: transforms research into a self-contained HTML one-pager.
//
// The model writes the ENTIRE document (D9). A forced emit_page tool returns one
// `html` field; a vertical-neutral design brief drives the structure and styling
// (see builder-prompt.ts), and a deterministic post-generation validator
// (domain/page-validation.ts) enforces the load-bearing invariants and rejects a
// noncompliant page. The builder retries a contract violation with a corrective
// note, then fails permanently; a truncated document fails transiently and
// retries on the lease.
//
// The page wears the prospect's own brand (D48). The Research Agent extracts the
// prospect's colors, font, logo, and favicon into research.brand; the builder
// resolves them into a per-lead :root custom-property block (brand-tokens.ts) and
// hands that block, plus the resolved assets, to the model, which themes every
// component over the variables. Resolution falls back token by token to the
// seller brand and then to house defaults.
//
// The business-value block is computed by the active vertical's value model
// (vertical.valueModel.compute), never by the builder and never by the model. The
// builder serializes the vertical-neutral ValueResult into the prompt as exact
// display strings, and the validator confirms every figure appears verbatim.

import { config } from "../config/env.ts";
import { generateStructured } from "../providers/anthropic.ts";
import { addUsage, emptyUsage, type TokenUsageTotals } from "../providers/usage.ts";
import {
  deriveTokens,
  renderTokenBlock,
  resolveLogoUrl,
  resolveFaviconHref,
  resolveGoogleFontHref,
} from "./brand-tokens.ts";
import { DESIGN_BRIEF, buildUserPrompt, type BuildSiteInput } from "./builder-prompt.ts";
import {
  validatePage,
  injectRuntimeAssets,
  PageValidationError,
} from "../domain/page-validation.ts";
import { validateDisclosurePolicy, ValueModelContractError } from "../verticals/contract.ts";
import type { ProductProfile } from "../domain/entities.ts";

export type { BuildSiteInput } from "./builder-prompt.ts";

// The finished page plus the token usage the build spent. Usage accumulates
// across corrective retries, so it counts the real spend a noncompliant first
// attempt incurs; the worker persists it per agent stage (D33 precursor infra).
export interface BuildSiteResult {
  html: string;
  usage: TokenUsageTotals;
}

// The required in-document anchors. Both the hero quick-links and the section ids
// must resolve to these; the validator enforces it.
const REQUIRED_ANCHORS = ["#business-case", "#book"];

// The bound on corrective regenerations before a contract violation fails
// permanently. One clean attempt plus two corrected attempts.
const MAX_ATTEMPTS = 3;

// The single-field schema for the emit_page tool. Forcing the tool removes any
// "Here is your HTML" preamble and markdown-fence failure modes and preserves the
// AgentRefusalError path the worker classifies as permanent.
const PAGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    html: {
      type: "string",
      description:
        "The complete self-contained HTML document, from <!DOCTYPE html> through </html>.",
    },
  },
  required: ["html"],
} as const;

// Resolve the booking target for the CTA. Prefer a seller-supplied scheduling
// URL; return null when none resolves, so the CTA falls back to a reply-to-email
// instruction rather than a dead link.
function bookingUrl(profile: ProductProfile): string | null {
  const link = profile.brand?.["cta_url"];
  return typeof link === "string" && /^https?:\/\//.test(link) ? link : null;
}

// Parse the lowercased host of an absolute http(s) URL, or undefined.
function hostOf(url: string | null | undefined): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

// Collect the external hosts this page may reference, beyond Google Fonts: the
// resolved logo, favicon, prospect site, and booking hosts. The validator
// allow-lists exactly these.
function collectAssetHosts(
  logoUrl: string | undefined,
  faviconHref: string | undefined,
  websiteUrl: string | null | undefined,
  booking: string | null,
): string[] {
  const hosts = new Set<string>();
  for (const candidate of [logoUrl, faviconHref, websiteUrl, booking]) {
    const host = hostOf(candidate);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

// Main export: buildSite receives the lead, profile, research, and vertical and
// returns the complete self-contained HTML document plus the build's token usage.
// The function:
// 1. Computes the value model deterministically via the vertical.
// 2. Resolves the brand tokens and assets.
// 3. Generates the full document via the forced emit_page tool.
// 4. Validates it, retries a contract violation with a corrective note, and
//    injects the trusted runtime assets before returning.
export async function buildSite(input: BuildSiteInput): Promise<BuildSiteResult> {
  const { onStep, vertical, lead, profile, research } = input;

  onStep?.({ phase: "value", detail: "computing business value" });
  const valueModel = vertical.createValueModel(profile);
  const validatedInputs = valueModel.validateInputs(
    research.extension.value_inputs,
    research.extension.estimated,
  );
  const value = valueModel.compute(validatedInputs);

  // Enforce D38/D49 disclosure policy (contract validation for Concern #2).
  // Throws ValueModelContractError on violation, which the worker classifies as
  // permanent. This catches misconfigured verticals at runtime before page render.
  try {
    validateDisclosurePolicy(value, research.extension.estimated);
  } catch (err) {
    if (err instanceof ValueModelContractError) {
      throw new Error(`value model contract violation: ${err.message}`);
    }
    throw err;
  }

  onStep?.({ phase: "brand", detail: "resolving brand tokens" });
  const brand = research.brand;
  const tokens = deriveTokens(profile, brand, vertical.defaultAccentColor);
  const tokenBlock = renderTokenBlock(tokens);
  const logoUrl = resolveLogoUrl(profile, brand);
  const faviconHref = resolveFaviconHref(lead.website_url, brand);
  const fontHref = resolveGoogleFontHref(brand?.font_family);
  const booking = bookingUrl(profile);
  const assetHosts = collectAssetHosts(logoUrl, faviconHref, lead.website_url, booking);

  const basePrompt = buildUserPrompt(input, value, {
    tokenBlock,
    logoUrl,
    faviconHref,
    fontHref,
    booking,
  });

  let prompt = basePrompt;
  let lastError: PageValidationError | null = null;
  // Accumulate usage across attempts so a corrective retry counts the real spend
  // its rejected predecessor incurred, not just the final clean call.
  let usage = emptyUsage();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onStep?.({ phase: "generate", detail: `generating page (attempt ${attempt})` });
    const { input: raw, stopReason, usage: callUsage } = await generateStructured({
      model: config.anthropic.builderModel,
      system: DESIGN_BRIEF,
      prompt,
      tool: {
        name: "emit_page",
        description: "Emit the complete self-contained HTML one-pager.",
        input_schema: PAGE_TOOL_SCHEMA,
      },
      maxTokens: config.agents.builderMaxTokens,
    });
    usage = addUsage(usage, callUsage);

    const html = typeof raw.html === "string" ? raw.html : "";

    try {
      validatePage(html, {
        value,
        research,
        assetHosts,
        requiredAnchors: REQUIRED_ANCHORS,
        stopReason,
      });
    } catch (err) {
      // A truncated document is transient: a corrective retry with the same token
      // ceiling repeats it, so surface it for the lease-retry path immediately.
      if (err instanceof PageValidationError && err.transient) throw err;
      // A contract violation retries in place with a corrective note appended to
      // the stable base prompt, then fails permanently when attempts exhaust.
      if (err instanceof PageValidationError) {
        lastError = err;
        onStep?.({ phase: "revalidate", detail: `attempt ${attempt} rejected: ${err.message}` });
        prompt = `${basePrompt}\n\nYOUR PREVIOUS OUTPUT FAILED VALIDATION: ${err.message}. Regenerate the COMPLETE document and correct exactly that problem. Keep every required figure verbatim and reference only the allowed assets.`;
        continue;
      }
      throw err;
    }

    const finalHtml = injectRuntimeAssets(html);
    onStep?.({ phase: "done", detail: `${finalHtml.length} bytes` });
    return { html: finalHtml, usage };
  }

  // Retries exhausted on a contract violation: fail permanently so the job fails
  // loudly rather than publishing a broken page.
  throw lastError ?? new PageValidationError("page failed validation after retries");
}
