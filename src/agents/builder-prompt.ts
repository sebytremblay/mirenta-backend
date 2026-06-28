import type { ResearchObject } from "../domain/research.ts";
import type { ProductProfile } from "../domain/entities.ts";
import type { ValueResult } from "../domain/value-contract.ts";
import type { MetricRecipe } from "../domain/recipe.ts";
import type { PageSpec, SectionSpec } from "../domain/page-spec.ts";

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
  // The metric recipe the strategist planned. The builder evaluates it against the
  // research's sourced inputs to the displayed value figure; the LLM never computes.
  recipe: MetricRecipe;
  // The bespoke page spec the designer composed. The builder renders exactly these
  // sections, in this order, under this art direction.
  spec: PageSpec;
  onStep?: (s: { phase: string; detail: string }) => void;
}

export interface PromptAssets {
  tokenBlock: string;
  logoUrl?: string;
  faviconHref?: string;
  fontHref?: string;
  booking: string | null;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// What each section kind asks the builder to render. The designer chooses which
// kinds appear and in what order; this fixes the meaning of each kind so the
// builder and the spec share one vocabulary without a hardcoded skeleton.
const SECTION_KIND_GUIDANCE: Record<SectionSpec["kind"], string> = {
  hero: "the prospect and seller lockup, an eyebrow naming the lead by name and role, the heading as an <h1>, a short lede, and the hero quick-link group",
  priorities: "the researched domain priorities as scannable cards",
  challenges: "the pressure each priority creates, as cards",
  pov: "the seller's point of view tied to each priority, with each VERIFIED respected-voice quote placed inside as a styled blockquote attributed and tagged by tier",
  value_render:
    "the precomputed value, sized to its role in the page: the headline value expression verbatim and large in var(--font-display) with its label, the one-sentence mechanism as plain prose beneath, and the footnote when present as small print. Render the supplied breakdown numbers as an honest visual that reconciles to the headline (labelled stat cells, or a compact inline bar or column figure built only from brand tokens and inline SVG). Show ONLY the supplied figure and breakdown numbers; invent no metric, percentage, projection, chart series, or scenario the value block does not list",
  cta: "a founder-to-founder ask in the seller's voice, rendering the booking action when a booking URL is supplied, otherwise instructing the reader to reply to the outreach email. Use no form",
  footer: "the supplied disclaimer text",
  narrative: "a short prose passage that carries the through-line for this founder, grounded in the research",
};

export const DESIGN_BRIEF = `You are the Mirenta Website Builder. You generate ONE self-contained, prospect-facing HTML one-pager that presents a personalized business case. The user message supplies structured research, a precomputed value model, and a bespoke PAGE SPEC: the exact sections to render, in order, and the art direction to follow. You render the entire document and return it through the emit_page tool.

OUTPUT CONTRACT
- Call emit_page with a single field "html" holding the COMPLETE document.
- The document starts with <!DOCTYPE html> and ends with </html>. Include exactly one <html>, one <head>, and one <body>.
- Put ALL CSS in ONE <style> block in the <head>. Use no external stylesheet except an optional Google Fonts <link> when one is provided.
- Write NO <script>, <iframe>, <object>, <embed>, or <form>. Use no inline event handlers (onclick, onerror, and the like) and no javascript: URLs. Mirenta injects the one approved animation script after you finish.
- Reference external resources ONLY from the asset URLs provided in the user message (logo, favicon, font link, booking URL). Invent no other external URL or image.

BRAND
- The user message supplies a :root token block. Paste it verbatim at the top of your <style> block and theme EVERY component with these custom properties: var(--brand), var(--brand-fg), var(--brand-strong), var(--brand-soft), var(--accent), var(--bg), var(--surface), var(--surface-muted), var(--surface-elevated), var(--surface-dark), var(--surface-dark-fg), var(--text), var(--muted), var(--border), var(--radius), var(--brand-tint), var(--brand-tint-strong), var(--shadow), var(--shadow-lg), var(--ring), var(--font-sans), var(--font-display). Derive every shade from these variables (rgba layering over the brand color is fine). Hardcode no color outside the token block.
- Use var(--font-display) for headings and var(--font-sans) for body. When a Google Fonts <link> is provided, include it and the two font preconnect links (https://fonts.googleapis.com and https://fonts.gstatic.com) in the <head>.
- Render the lead company logo when a logo URL is provided; otherwise render a clean text wordmark of the company name. Pair it with the seller name as a partnership lockup in the hero.

PAGE SPEC (the structure is bespoke to this lead, not a fixed template)
- The user message lists the exact sections to render, in order, each with an id, a kind, an ARIA landmark, and a heading. Render every listed section, in the listed order, using the listed id and landmark, and the listed heading as the section's labelled heading. Add no section the spec omits and drop none it names.
- Each section kind tells you what to place inside it. Follow the kind guidance in the user message. The value_render section carries the value figure; the cta section carries the call to action.
- Build the hero quick-link group from the listed quick-link targets: one <a href="#id"> per target, each resolving to a section id in this document.

ART DIRECTION (named by the designer, not a fixed menu)
- The user message names the art direction, a signature element, a type treatment, and a few supporting motifs. Commit to that one direction for the whole page so it reads as one deliberate hand, not a template. Spend the page's boldness on the signature element and keep the motifs quiet beneath it. Execute the type treatment and the motifs using ONLY the brand tokens and CSS. The art direction is decoration: it must not add, rename, or remove any section, id, link, role, or figure the spec names.

LAYOUT AND STYLE (one bold idea, executed with restraint)
This page must look like a designer with taste built it, not a form filled in and not every effect switched on at once. A page earns a founder's attention through ONE strong idea carried with conviction, surrounded by quiet. The fastest way to read as AI-generated is to stack every device (a saturated hero AND alternating bands AND a dark panel AND a chart AND bordered cards) onto one page; that sum reads as cluttered template boilerplate, the failure to avoid. Invest in the <style> block, but spend that investment on craft and restraint, not on piling effects. CSS does not count toward the word budget.
- The user message names a SIGNATURE ELEMENT. That is the one bold move this page commits to. Execute it with full conviction and let it lead the page. Hold everything else quiet: generous whitespace, restrained type, a single accent, calm grounds. If a device does not serve the signature element, cut it. When in doubt, remove one thing.
- Define a quiet design system at the top of <style>, layered over the brand tokens: a spacing scale (for example --s1 4px through --s9 96px) used consistently for every margin and pad, a fluid clamp() type scale for h1/h2/h3/lede, and a radius and a restrained shadow set derived from the brand color. Use the scale to give the page air; whitespace is the cheapest path to a composed look.
- Center content in a container near 1120px max width. Hold prose to a 62 to 70 character measure. Give sections generous vertical rhythm (near --s9 top and bottom), never a flat uniform pad.
- Choose a deliberate type pairing across var(--font-display) and var(--font-sans). Let type carry personality: a confident display size for the hero heading and a clear hierarchy below it. Strong typography alone serves as the signature element when the designer named it so.
- Make the hero a thesis for this founder, not a template banner. Build it from the brand tokens and let the signature element shape it. Color it with restraint unless the signature element is the hero itself: a full-strength brand background belongs only where boldness is the intended move, not as a default on every page. Include the partnership lockup, an eyebrow, the display <h1>, a lede, and the quick-link group. Whatever ground you choose, keep heading text legible on it.
- Do NOT default to alternating section grounds as the page's rhythm. Alternating bands are one option, never the spine of the design, and leaning on them as the only styling mechanism is exactly the generic look to avoid. Prefer whitespace, the type scale, and the signature element to separate sections. Reach for a contrasting ground or a dark panel only when it serves the signature element, and use at most one such moment, not a band on every section.
- Keep components calm. Render cards as quiet containers: padding from the scale, one restrained edge or hairline from brand tokens, at most a soft shadow. Do not give every card a heavy border AND a colored number AND a shadow AND a hover lift at once; pick the lightest treatment that reads as structured. Style a blockquote as one designed pull quote with a single accent rule and a clear attribution, not as a busy panel.
- Keep subordinate headings quiet so the signature stays singular. Unless the named signature element IS the typography itself, do not paint section headings and card headings in the full-strength brand color or set them in the heaviest display face at once: a row of loud colored display headings competes with the signature and reads as the generic look to avoid. Set card and section headings in restrained weight and the standard text color, and reserve the boldest type and the brand color for the one signature moment.
- Render the value figure as a clear, honest visual sized to its role in the page (the visual peak only when the designer made it the signature element). Show the figure large in var(--font-display) with its label, the mechanism beneath, and the breakdown numbers as an honest visual that reconciles to the headline: a compact inline-SVG figure where each breakdown number maps to a bar height or segment length the eye can compare (not uniform boxes of equal size, and not prose standing in for a chart), or labelled stat cells, all from brand tokens. Build it from the supplied figure and breakdown numbers only.
- Use inline SVG for restrained marks, dividers, wordmarks, and the value figure's chart. Inline SVG does not count toward the word budget. Give inline SVG no external href or src and no script.
- Build all depth with CSS only: gradients from the brand tokens, the shadow set, var(--surface-elevated), and layered var(--brand-tint). Use no external image except the provided logo and favicon. Use no @import and no background-image URL.
- Apply hover and focus transitions through CSS, and honor prefers-reduced-motion.

FIGURES
- The value model supplies one value expression as an exact display string. Render that string verbatim inside the value_render section. Never invent, recompute, or reformat the figure, and add no figure the model did not supply.

READING TIME
- Hold body copy to roughly 450 to 600 words, a read under two minutes. Fewer words read as more confident. Cut every sentence that restates another, prefer scannable cards and tight sentences over paragraphs, and never pad a section to fill space. When a section earns its place with three sentences, write three.

ACCESSIBILITY
- Use the landmark roles the spec assigns (banner, main, contentinfo, region). Tie aria-labelledby on each section to its heading id. Provide a visually hidden .sr-only utility. Apply :focus-visible outlines on links. Respect prefers-reduced-motion for any transition.

WRITING STYLE (enforce strictly)
- No contractions. Active voice. Present tense. Strong verbs. No weak openers ("there is", "it is"). No em dashes. No AI filler words (delve, leverage, robust, seamless, unlock, transformative).
- Ground every claim in the supplied research. Fabricate no facts, metrics, customers, or quotes. Use only the supplied verified quotes.

COPY THAT READS HUMAN, NOT MACHINE-GENERATED
- Write no symmetrical tricolons ("faster, smarter, better"). Break the rhythm instead.
- Open no sentence with "In a world where", "Imagine a", "It is no secret that", or "In today's fast-paced".
- Use no hollow superlatives: cutting-edge, world-class, best-in-class, game-changing, revolutionary, next-generation.
- Write no empty connective scaffolding: "That is why", "This is where X comes in", "The result?".
- Vary sentence length deliberately. Set a short, punchy sentence next to a longer one. Never run three same-length sentences in a row.
- Use no rhetorical question as a heading.
- Name the specific researched fact rather than abstracting it. Mirror the prospect's own self-description language where it fits.
- Write headings concrete to this prospect, not generic ("Where Replit loses founder-hours", not "The Challenge").`;

export function renderValueBlock(value: ValueResult): string {
  const lines: string[] = [];
  lines.push(`Section title: ${value.sectionTitle}`);
  lines.push(`Headline: ${value.headline.label}: ${value.headline.value}`);
  lines.push(`Mechanism: ${value.mechanism}`);
  if (value.breakdown.length > 0) {
    lines.push(
      "Breakdown (the sourced numbers behind the figure; render these as a visual that reconciles to the headline, for example labelled stat cells or a simple inline bar built from brand tokens; never invent a number not listed here):",
    );
    for (const item of value.breakdown) {
      const tag = item.estimated ? " (estimated)" : "";
      lines.push(`  - ${item.label}: ${item.value}${tag}`);
    }
  }
  if (value.footnote) lines.push(`Footnote: ${value.footnote}`);
  return lines.join("\n");
}

// Render the bespoke spec into the prompt: the ordered sections with their ids,
// kinds, landmarks, and headings, plus the kind guidance and the art direction.
export function renderSpecBlock(spec: PageSpec): string {
  const sectionLines = spec.sections
    .map((s, i) => {
      const refs = s.contentRefs.length > 0 ? ` [draws on: ${s.contentRefs.map(escapeHtml).join(", ")}]` : "";
      return `${i + 1}. id="${s.id}" kind=${s.kind} landmark=${s.landmark} heading="${escapeHtml(s.heading)}"${refs}\n   Render: ${SECTION_KIND_GUIDANCE[s.kind]}`;
    })
    .join("\n");

  const motifs =
    spec.artDirection.motifs.length > 0
      ? spec.artDirection.motifs.map((m) => `- ${escapeHtml(m)}`).join("\n")
      : "- (none named; keep decoration restrained)";

  return `SECTIONS (render every one, in this order, with the exact id and landmark)
${sectionLines}

VALUE-RENDER SECTION: id="${spec.valueRenderSectionId}" carries the value figure.
CTA SECTION: id="${spec.ctaSectionId}" carries the call to action.

HERO QUICK-LINKS (one <a href="#id"> per target, each resolving to a section above)
${spec.quickLinkTargets.map((t) => `- href="#${t}"`).join("\n")}

ART DIRECTION: ${escapeHtml(spec.artDirection.name)}
SIGNATURE ELEMENT (the one bold move; execute this with conviction and keep everything else quiet): ${escapeHtml(spec.artDirection.signatureElement)}
Type treatment: ${escapeHtml(spec.artDirection.typeTreatment)}
Supporting motifs (quiet details, never a second bold move competing with the signature):
${motifs}`;
}

export function buildUserPrompt(
  input: BuildSiteInput,
  value: ValueResult,
  assets: PromptAssets,
): string {
  const { lead, profile, research, spec } = input;
  const fullName = `${lead.first_name} ${lead.last_name}`;
  const role = lead.role ? escapeHtml(lead.role) : "";

  const priorityLines = research.extension.priorities
    .map(
      (p) => `- ${escapeHtml(p.domain)}: ${escapeHtml(p.pov)} Why now: ${escapeHtml(p.why_now)}`,
    )
    .join("\n");

  const verifiedVoices = research.voices.filter((v) => v.quote.verified);
  const voiceLines =
    verifiedVoices.length > 0
      ? verifiedVoices
          .map(
            (v) =>
              `- ${escapeHtml(v.name)} (${escapeHtml(v.identity)}) [tier: ${escapeHtml(v.tier)}]: "${escapeHtml(v.quote.text)}"`,
          )
          .join("\n")
      : "None available. Render no quotes.";

  const recentMoves =
    research.account.recent_moves.length > 0
      ? research.account.recent_moves.map((m) => `- ${escapeHtml(m)}`).join("\n")
      : "None noted.";

  const assetLines: string[] = [];
  assetLines.push(
    assets.logoUrl
      ? `Lead logo URL: ${assets.logoUrl}`
      : "Lead logo URL: none (render a text wordmark of the company name).",
  );
  if (assets.faviconHref) assetLines.push(`Favicon href: ${assets.faviconHref}`);
  assetLines.push(
    assets.fontHref
      ? `Google Fonts link (include in <head>): ${assets.fontHref}`
      : "Google Fonts link: none (use the system font stack in the tokens).",
  );
  assetLines.push(
    assets.booking
      ? `Booking URL for the CTA action: ${assets.booking}`
      : "Booking URL: none (render the CTA as an instruction to reply to the outreach email; add no external link).",
  );

  const disclaimer = `Mirenta prepares this page for ${escapeHtml(lead.company)}. It offers one founder-to-founder point of view drawn from public research. Read it as a starting point and confirm it against your own situation.`;

  return `LEAD
${escapeHtml(fullName)}${role ? `, ${role}` : ""} at ${escapeHtml(lead.company)}.

SELLER
${escapeHtml(profile.company_name)} / ${escapeHtml(profile.product_name)}.
Value proposition: ${escapeHtml(profile.value_prop)}
${profile.positioning ? `Positioning: ${escapeHtml(profile.positioning)}` : ""}
CTA label: ${escapeHtml(profile.cta_text || "Trade notes founder to founder")}

ACCOUNT
Summary: ${escapeHtml(research.account.summary)}
How they describe themselves: ${escapeHtml(research.account.self_description_language)}
Recent moves:
${recentMoves}

DOMAIN PRIORITIES (${research.extension.domains.map((d) => escapeHtml(d)).join(", ")})
${priorityLines || "None available."}

RESPECTED VOICES (place each inside the section it supports, attributed and tagged by tier)
${voiceLines}

VALUE RENDER (render these exact strings verbatim; do not recompute or reformat)
${renderValueBlock(value)}

BRAND TOKENS (paste verbatim at the top of your <style> block)
${assets.tokenBlock}

ASSETS
${assetLines.join("\n")}

${renderSpecBlock(spec)}

FOOTER DISCLAIMER (render verbatim in the section assigned the contentinfo landmark)
${disclaimer}

Generate the complete page now.`;
}
