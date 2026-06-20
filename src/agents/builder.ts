// Website Builder: transforms research into a self-contained HTML one-pager.
//
// The builder uses generateStructured to produce PROSE CONTENT as a validated
// object, then assembles the final HTML deterministically in TypeScript. This
// keeps the markup structure reliable and self-contained. The model generates
// headline, account narrative, executive blurbs, and POV sections. Deterministic
// code weaves them together with computed ROI data and verified quotes.
//
// The page wears the prospect's own brand (D48). The Research Agent extracts the
// prospect's colors, font, logo, and favicon into research.brand; assembly maps
// them onto a per-lead CSS custom-property block (see brand-tokens.ts) and falls
// back token by token to the seller brand and then to house defaults. All CSS
// lives in one <style> tag, so the page stays a single self-contained object
// with no per-lead build step.
//
// The business-value block is computed by the active vertical's value model
// (vertical.valueModel.compute), not by the builder and not by the model. The
// builder renders the vertical-neutral ValueResult it returns: a section title, a
// headline figure, scenario stat cards, and an optional footnote. The value model
// never invents numbers.
//
// All copy follows the HOUSE WRITING STYLE: no contractions, active voice, present
// tense, strong verbs, no weak openers, no em dashes, no AI filler words.

import { config } from "../config/env.ts";
import { generateStructured } from "../providers/anthropic.ts";
import type { ResearchObject } from "../domain/research.ts";
import type { ProductProfile } from "../domain/entities.ts";
import type { ValueResult, VerticalSpec } from "../verticals/index.ts";
import {
  deriveTokens,
  renderTokenBlock,
  resolveLogoUrl,
  resolveFaviconHref,
} from "./brand-tokens.ts";

// The input to buildSite matches the contract specified in the task.
export interface BuildSiteInput {
  lead: {
    first_name: string;
    last_name: string;
    role?: string | null;
    company: string;
    website_url?: string | null;
  };
  profile: ProductProfile;
  research: ResearchObject;
  // The active vertical (resolved from profile.vertical). Supplies the value
  // model the builder computes the business-value block from, and the accent
  // color the page falls back to when no brand color resolves.
  vertical: VerticalSpec;
  onStep?: (s: { phase: string; detail: string }) => void;
}

// The schema for the prose content tool. The model fills this; deterministic
// code assembles the final HTML from this structure plus computed ROI data.
const CONTENT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "Bold headline for the page" },
    subhead: {
      type: "string",
      description: "Supporting subhead that introduces the value proposition",
    },
    account_narrative: {
      type: "string",
      description: "Executive summary paragraph capturing the account priorities",
    },
    executive_blurbs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          intro: {
            type: "string",
            description: "A concise blurb tying this executive to the solution",
          },
        },
        required: ["name", "intro"],
      },
    },
    cta_heading: { type: "string" },
    cta_body: { type: "string" },
  },
  required: [
    "headline",
    "subhead",
    "account_narrative",
    "executive_blurbs",
    "cta_heading",
    "cta_body",
  ],
} as const;

interface ContentPayload {
  headline: string;
  subhead: string;
  account_narrative: string;
  executive_blurbs: Array<{ name: string; intro: string }>;
  cta_heading: string;
  cta_body: string;
}

// Defensive read of the model's tool output. generateStructured forces the tool
// but does not guarantee every field, so default the arrays and coerce strings
// rather than blindly casting (which would crash assembly on a missing field).
function normalizeContent(raw: Record<string, unknown>): ContentPayload {
  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
  const blurbs = Array.isArray(raw.executive_blurbs)
    ? (raw.executive_blurbs as unknown[])
        .map((b) => b as Record<string, unknown>)
        .filter((b) => typeof b.name === "string")
        .map((b) => ({ name: str(b.name), intro: str(b.intro) }))
    : [];
  return {
    headline: str(raw.headline),
    subhead: str(raw.subhead),
    account_narrative: str(raw.account_narrative),
    executive_blurbs: blurbs,
    cta_heading: str(raw.cta_heading, "Explore the opportunity"),
    cta_body: str(raw.cta_body),
  };
}

// Escape dynamic text for safe HTML insertion.
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The CTA target. The MVP page carries no form, so the button links to the
// prospect's own site when known, else to the top of this page, rather than a
// dead in-page anchor.
function ctaHref(profile: ProductProfile): string {
  const link = profile.brand?.["cta_url"];
  if (typeof link === "string" && /^https?:\/\//.test(link)) return link;
  return "#top";
}

// Render the executive cards section.
function renderExecutiveCards(
  research: ResearchObject,
  content: ContentPayload,
): string {
  // Match content blurbs to research executives by name (case-insensitive).
  const blurbMap = new Map(
    content.executive_blurbs.map((b) => [b.name.toLowerCase(), b.intro]),
  );

  const cards = research.executives
    .map((exec) => {
      const intro = blurbMap.get(exec.name.toLowerCase()) || exec.profile;
      return `
        <div class="executive-card">
          <h3>${escapeHtml(exec.name)}</h3>
          <p class="title">${escapeHtml(exec.title)}</p>
          <p class="owns">Owns: ${escapeHtml(exec.owns)}</p>
          <p>${escapeHtml(intro)}</p>
        </div>`;
    })
    .join("");

  return `
    <section class="executives">
      <h2>Leadership</h2>
      <div class="executive-grid">
        ${cards}
      </div>
    </section>`;
}

// Render the domain POV sections grounded in the researched priorities. The
// domains come from the vertical, so this stays generic. The page reflects the
// verified pov and why_now in a fixed order rather than free model prose, so the
// copy cannot drift from the research.
function renderDomainSections(research: ResearchObject): string {
  return research.extension.priorities
    .map(
      (p) => `
      <section class="domain-section">
        <h2>${escapeHtml(p.domain)}</h2>
        <p>${escapeHtml(p.pov)}</p>
        <p class="why-now"><strong>Why now:</strong> ${escapeHtml(p.why_now)}</p>
      </section>`,
    )
    .join("");
}

// Render the verified quotes section.
function renderQuotesSection(research: ResearchObject): string {
  const verified = research.quotes.filter((q) => q.verified);
  if (verified.length === 0) return "";

  const items = verified
    .map(
      (q) => `
      <blockquote>
        <p>"${escapeHtml(q.text)}"</p>
        <cite>— ${escapeHtml(q.speaker)}</cite>
      </blockquote>`,
    )
    .join("");

  return `
    <section class="quotes">
      <h2>In Their Words</h2>
      ${items}
    </section>`;
}

// Render the business-value section from the vertical's computed ValueResult:
// scenario stat cards, a headline figure, and an optional footnote. Every label
// rides in the ValueResult, so the section reads correctly whether the value is
// savings, revenue uplift, time recovered, or risk avoided.
function renderValueSection(value: ValueResult): string {
  const cards = value.scenarios
    .map(
      (s) => `
      <div class="roi-card">
        <h4>${escapeHtml(s.name.charAt(0).toUpperCase() + s.name.slice(1))}</h4>
        <p class="roi-value">${escapeHtml(s.primaryValue)}</p>
        <p class="roi-label">${escapeHtml(s.primaryLabel)}</p>
        ${s.secondary ? `<p class="roi-percent">${escapeHtml(s.secondary)}</p>` : ""}
      </div>`,
    )
    .join("");

  const footnote = value.footnote
    ? `<p class='roi-footnote'>${escapeHtml(value.footnote)}</p>`
    : "";

  return `
    <section class="roi">
      <h2>${escapeHtml(value.sectionTitle)}</h2>
      <p class="roi-headline">${escapeHtml(value.headline.label)}: <strong>${escapeHtml(value.headline.value)}</strong></p>
      <div class="roi-grid">
        ${cards}
      </div>
      ${footnote}
    </section>`;
}

// Assemble the final HTML document.
function assembleHtml(
  input: BuildSiteInput,
  content: ContentPayload,
  value: ValueResult,
): string {
  const { lead, profile, research, vertical } = input;
  const brand = research.brand;
  const tokens = deriveTokens(profile, brand, vertical.defaultAccentColor);

  // Brand assets (D48). Wear the prospect's own brand: prefer the prospect logo
  // and favicon the Research Agent extracted from the prospect site, then fall
  // back to the seller-supplied logo and the prospect site's /favicon.ico, then
  // to a clean text wordmark when no logo resolves.
  const faviconHref = resolveFaviconHref(lead.website_url, brand);
  const faviconLink = faviconHref ? `<link rel="icon" href="${escapeHtml(faviconHref)}">` : "";
  const logoUrl = resolveLogoUrl(profile, brand);
  const logoMarkup = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(lead.company)}" class="logo">`
    : "";

  const ctaText = profile.cta_text || "Start the conversation";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(lead.company)} + ${escapeHtml(profile.company_name)}</title>
  ${faviconLink}
  <style>
    ${renderTokenBlock(tokens)}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      line-height: 1.6;
      color: var(--text);
      background: var(--bg);
    }
    header {
      background: var(--brand);
      color: var(--brand-fg);
      padding: 2rem;
      text-align: center;
    }
    header .logo { max-height: 40px; margin-bottom: 1rem; }
    header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    header p { font-size: 1.1rem; opacity: 0.95; }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: var(--surface);
    }
    section {
      margin-bottom: 3rem;
    }
    h2 {
      font-size: 1.8rem;
      margin-bottom: 1rem;
      color: var(--brand);
    }
    h3 {
      font-size: 1.3rem;
      margin-bottom: 0.5rem;
    }
    h4 {
      font-size: 1.1rem;
      margin-bottom: 0.25rem;
    }
    p {
      margin-bottom: 1rem;
    }
    .executive-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
    }
    .executive-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      background: var(--surface-muted);
    }
    .executive-card .title {
      font-weight: 600;
      color: var(--muted);
    }
    .executive-card .owns {
      font-style: italic;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .domain-section {
      border-left: 4px solid var(--accent);
      padding-left: 1.5rem;
      margin-bottom: 2rem;
    }
    .domain-section .why-now {
      color: var(--muted);
      font-size: 0.95rem;
    }
    .quotes blockquote {
      border-left: 4px solid var(--border);
      padding-left: 1rem;
      margin: 1rem 0;
      font-style: italic;
      color: var(--muted);
    }
    .quotes cite {
      display: block;
      margin-top: 0.5rem;
      font-style: normal;
      font-weight: 600;
      color: var(--text);
    }
    .roi {
      background: var(--brand-tint);
      padding: 2rem;
      border-radius: var(--radius);
    }
    .roi-headline {
      font-size: 1.3rem;
      margin-bottom: 1.5rem;
    }
    .roi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
    }
    .roi-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      text-align: center;
    }
    .roi-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--brand);
      margin: 0.5rem 0;
    }
    .roi-label {
      font-size: 0.9rem;
      color: var(--muted);
      margin-bottom: 0.5rem;
    }
    .roi-percent {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text);
    }
    .roi-footnote {
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: 1rem;
    }
    .cta {
      background: var(--brand);
      color: var(--brand-fg);
      padding: 2rem;
      border-radius: var(--radius);
      text-align: center;
    }
    .cta h2 { color: var(--brand-fg); margin-bottom: 1rem; }
    .cta p { margin-bottom: 1.5rem; }
    .cta a {
      display: inline-block;
      background: var(--surface);
      color: var(--brand);
      padding: 0.75rem 2rem;
      border-radius: var(--radius);
      text-decoration: none;
      font-weight: 600;
    }
    footer {
      text-align: center;
      padding: 2rem;
      color: var(--muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body id="top">
  <header>
    ${logoMarkup}
    <h1>${escapeHtml(lead.company)} + ${escapeHtml(profile.company_name)}</h1>
    <p>${escapeHtml(profile.product_name)} for ${escapeHtml(lead.company)}</p>
  </header>

  <div class="container">
    <section class="intro">
      <h2>${escapeHtml(content.headline)}</h2>
      <p class="subhead"><strong>${escapeHtml(content.subhead)}</strong></p>
      <p>${escapeHtml(content.account_narrative)}</p>
    </section>

    ${renderExecutiveCards(research, content)}

    ${renderDomainSections(research)}

    ${renderQuotesSection(research)}

    ${renderValueSection(value)}

    <section class="cta" id="contact">
      <h2>${escapeHtml(content.cta_heading)}</h2>
      <p>${escapeHtml(content.cta_body)}</p>
      <a href="${escapeHtml(ctaHref(profile))}">${escapeHtml(ctaText)}</a>
    </section>
  </div>

  <footer>
    <p>Mirenta prepares this page for ${escapeHtml(lead.company)}. The value figures model industry benchmarks and serve as illustration. Confirm them against your own operational data.</p>
  </footer>
</body>
</html>`;

  return html;
}

// Construct the system prompt that enforces the house writing style and guides
// the model to produce page copy aligned with the research.
function buildSystemPrompt(): string {
  return `You are a website content generator for personalized sales one-pagers.

HOUSE WRITING STYLE (enforce strictly):
- No contractions
- Active voice
- Present tense
- Strong verbs
- No weak openers ("there is", "it is")
- No em dashes
- No AI filler words: delve, leverage, robust, seamless, unlock, transformative, etc.

Your output is prose only. Do not write HTML. The assembly layer combines your content with computed ROI data, the researched domain priorities, and verified quotes.

Produce clear, confident, executive-ready copy that ties the prospect company's priorities to the seller's platform.`;
}

// Construct the user prompt that provides the research context and the lead info.
function buildUserPrompt(input: BuildSiteInput, value: ValueResult): string {
  const { lead, profile, research } = input;
  const fullName = `${lead.first_name} ${lead.last_name}`;
  const rolePhrase = lead.role ? ` (${lead.role})` : "";

  // Serialize executives for the model.
  const execLines = research.executives
    .map((e) => `- ${e.name}, ${e.title}: ${e.profile}`)
    .join("\n");

  // Serialize domain priorities.
  const domainLines = research.extension.priorities
    .map((p) => `- ${p.domain}: ${p.pov}`)
    .join("\n");

  // Serialize verified quotes only.
  const verifiedQuotes = research.quotes.filter((q) => q.verified);
  const quoteLines =
    verifiedQuotes.length > 0
      ? verifiedQuotes.map((q) => `- "${q.text}" — ${q.speaker}`).join("\n")
      : "None available.";

  const recentMoves =
    research.account.recent_moves.length > 0
      ? research.account.recent_moves.map((m) => `- ${m}`).join("\n")
      : "None noted.";

  return `Lead: ${fullName}${rolePhrase} at ${lead.company}.

Seller: ${profile.company_name} / ${profile.product_name}.
Value proposition: ${profile.value_prop}
${profile.positioning ? `Positioning: ${profile.positioning}` : ""}

Account summary: ${research.account.summary}
How they describe themselves: ${research.account.self_description_language}

Recent moves:
${recentMoves}

Executives:
${execLines}

Domain priorities (${research.extension.domains.join(", ")}):
${domainLines}

Verified quotes:
${quoteLines}

Business value: ${value.headline.label} is ${value.headline.value}.

Generate the page copy: a headline, a subhead, an account narrative that reflects the recent moves and the way they describe themselves, a short intro for each named executive that ties them to the seller's platform, and a CTA. The domain priority sections are rendered separately from the research, so do not write those.`;
}

// Main export: buildSite receives the lead, profile, research, and vertical, and
// returns a complete self-contained HTML document as a string. The function:
// 1. Computes the value model deterministically via the vertical (no model
//    involvement).
// 2. Generates the prose content via generateStructured.
// 3. Assembles the final HTML in TypeScript (no model-generated HTML).
export async function buildSite(input: BuildSiteInput): Promise<string> {
  const { onStep, vertical } = input;

  onStep?.({ phase: "value", detail: "computing business value" });
  const validatedInputs = vertical.valueModel.validateInputs(
    input.research.extension.value_inputs,
    input.research.extension.estimated,
  );
  const value = vertical.valueModel.compute(validatedInputs);

  onStep?.({ phase: "content", detail: "generating page copy" });
  const system = buildSystemPrompt();
  const prompt = buildUserPrompt(input, value);

  const raw = await generateStructured({
    model: config.anthropic.builderModel,
    system,
    prompt,
    tool: {
      name: "emit_content",
      description: "Emit the prose content for the page",
      input_schema: CONTENT_TOOL_SCHEMA,
    },
    maxTokens: config.agents.builderMaxTokens,
  });

  // Normalize defensively rather than blind-casting: a missing field degrades to
  // a sensible default instead of crashing assembly.
  const content = normalizeContent(raw);

  onStep?.({ phase: "assembly", detail: "assembling HTML" });
  const html = assembleHtml(input, content, value);

  onStep?.({ phase: "done", detail: `${html.length} bytes` });
  return html;
}
