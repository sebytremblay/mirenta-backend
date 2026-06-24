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
import { validateDisclosurePolicy } from "../verticals/contract.ts";
import type { ProductProfile } from "../domain/entities.ts";

export type { BuildSiteInput } from "./builder-prompt.ts";

export interface BuildSiteResult {
  html: string;
  usage: TokenUsageTotals;
}

const REQUIRED_ANCHORS = ["#business-case", "#book"];

const MAX_ATTEMPTS = 3;

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

function bookingUrl(profile: ProductProfile): string | null {
  const link = profile.brand?.["cta_url"];
  return typeof link === "string" && /^https?:\/\//.test(link) ? link : null;
}

function hostOf(url: string | null | undefined): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

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

export async function buildSite(input: BuildSiteInput): Promise<BuildSiteResult> {
  const { onStep, vertical, lead, profile, research } = input;

  onStep?.({ phase: "value", detail: "computing business value" });
  const valueModel = vertical.createValueModel(profile);
  const validatedInputs = valueModel.validateInputs(
    research.extension.value_inputs,
    research.extension.estimated,
  );
  const value = valueModel.compute(validatedInputs);

  validateDisclosurePolicy(value, research.extension.estimated);

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
      if (err instanceof PageValidationError && err.transient) throw err;
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

  throw lastError ?? new PageValidationError("page failed validation after retries");
}
