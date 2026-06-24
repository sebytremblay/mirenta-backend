// Pure prompt construction for the Website Builder. This module holds the design
// brief and the per-lead prompt assembly with no runtime config import, so it
// stays unit-testable without loading the API client or env (the same split
// brand-tokens.ts uses). builder.ts imports these and adds the API call, the
// validator, and the retry loop.
//
// All copy follows the HOUSE WRITING STYLE: no contractions, active voice, present
// tense, strong verbs, no weak openers, no em dashes, no AI filler words.

import type { ResearchObject } from "../domain/research.ts";
import type { ProductProfile } from "../domain/entities.ts";
import type { ValueResult, VerticalSpec } from "../verticals/index.ts";

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

// The resolved per-lead assets the prompt carries into the document.
export interface PromptAssets {
  tokenBlock: string;
  logoUrl?: string;
  faviconHref?: string;
  fontHref?: string;
  booking: string | null;
}

// Escape dynamic text before it enters the prompt. Research text is untrusted
// input; pre-escaping means it cannot introduce markup when the model copies it
// into the page, and the HTML entities render correctly.
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The vertical-neutral design brief. Byte-stable so it forms a cache-stable
// prefix; every per-lead value rides in the user prompt. The brief drives off the
// data passed in (domains, priorities, value labels) and never hardcodes a
// vertical, so a second vertical stays a data-only add.
export const DESIGN_BRIEF = `You are the Mirenta Website Builder. You generate ONE self-contained, prospect-facing HTML one-pager that presents a personalized business case. The user message supplies structured research and a precomputed value model. You render the entire document and return it through the emit_page tool.

OUTPUT CONTRACT
- Call emit_page with a single field "html" holding the COMPLETE document.
- The document starts with <!DOCTYPE html> and ends with </html>. Include exactly one <html>, one <head>, and one <body>.
- Put ALL CSS in ONE <style> block in the <head>. Use no external stylesheet except an optional Google Fonts <link> when one is provided.
- Write NO <script>, <iframe>, <object>, <embed>, or <form>. Use no inline event handlers (onclick, onerror, and the like) and no javascript: URLs. Mirenta injects the one approved animation script after you finish.
- Reference external resources ONLY from the asset URLs provided in the user message (logo, favicon, font link, booking URL). Invent no other external URL or image.

BRAND
- The user message supplies a :root token block. Paste it verbatim at the top of your <style> block and theme EVERY component with these custom properties: var(--brand), var(--brand-fg), var(--accent), var(--bg), var(--surface), var(--surface-muted), var(--text), var(--muted), var(--border), var(--radius), var(--brand-tint), var(--font-sans), var(--font-display). Derive every shade from these variables (rgba layering over the brand color is fine). Hardcode no color outside the token block.
- Use var(--font-display) for headings and var(--font-sans) for body. When a Google Fonts <link> is provided, include it and the two font preconnect links in the <head>.
- Render the lead company logo when a logo URL is provided; otherwise render a clean text wordmark of the company name. Pair it with the seller name as a partnership lockup in the hero.

DESIGN DIRECTION
- Design as the lead at a studio that gives every client a visual identity no one would mistake for another. This prospect rejects anything that looks templated. Before you write a line of CSS, commit to ONE distinct aesthetic direction grounded in this prospect's own world: their industry, their materials, the language they use about themselves, the moment they are in. State that direction to yourself, then build every choice from it.
- Spend your boldness in one place. Choose a single signature element the page is remembered by (a typographic treatment, an editorial grid, a structural device, an orchestrated hero) and execute it with conviction. Keep everything around it quiet and disciplined. A page that shouts everywhere reads as generated; a page with one confident idea reads as designed.
- Treat the hero as a thesis. Open with the most characteristic thing in this prospect's world, in whatever form fits it. A big number over a small label with a gradient accent is the default answer; reach past it unless it is genuinely the strongest opening for this prospect.
- Make structure carry meaning. Eyebrows, dividers, numbering, and labels must encode something true about the content, never decorate it. Number a sequence only when the content is an actual ordered sequence.
- Match the build to the vision. A maximalist direction earns elaborate detail; a minimal direction demands precision in spacing, type scale, and rhythm. Elegance is executing the chosen direction well, not adding more.
- Use motion deliberately and sparingly. One orchestrated moment (a considered page-load reveal, a scroll-triggered transition, a restrained hover state) lands harder than scattered effects, and extra animation reads as AI-generated. Respect prefers-reduced-motion for everything you add.
- Hold prose to a comfortable reading measure and let the layout breathe responsively from mobile up. Choose the container width, the grid, and the breakpoints that serve your direction rather than a fixed template. Set a deliberate type scale with intentional weights and spacing using fluid clamp() sizing. Theme every surface from the supplied tokens; reach for var(--brand-tint), an on-brand panel, rounded corners (var(--radius)), or generous negative space to set rhythm, and vary the treatment section to section so no two read identically.

AVOID THE AI-GENERATED LOOK
- Right now generated design clusters around three looks. Do not spend a free design axis on any of them: (1) a warm cream background near #F4F1EA with a high-contrast serif display and a terracotta accent; (2) a near-black background with one bright acid-green or vermilion accent; (3) a broadsheet layout with hairline rules, zero border-radius, and dense newspaper columns. Each is a legitimate choice for the right brief and a tell when it appears by default.
- The prospect's resolved brand colors always win where the tokens supply them. Only the axes the tokens leave open are yours to set, and on those axes make a deliberate choice for THIS prospect, not a habit.
- Take one real aesthetic risk you can justify from the prospect's world. Not taking a risk is itself a risk: it produces the templated page the prospect already rejected.

STYLE GUARDRAILS
- Write NO emoji and NO decorative pictographs anywhere in the document, including card icons. Signal a card with a typographic accent built from the brand tokens (a colored rule, a numbered marker, a tinted panel, an SVG glyph you draw inline), never a pictographic character. An emoji is an instant AI tell and the page rejects on it.
- Render NO em dash or en dash (— or –) anywhere in copy or attribution. Use a comma, a period, or a colon. The page rejects on either dash.

REQUIRED SECTIONS, IN THIS ORDER, WITH THESE EXACT ids
1. Hero: a header element with role="banner". Include the prospect and seller lockup, an eyebrow, an <h1>, and a short lede. Include a quick-link group with TWO links: one with href="#business-case" and one with href="#book". Both targets must resolve in this document. By default the eyebrow names the lead by name and role and the hero leads with the lockup. When the user message carries a HERO NARRATIVE block, follow its opening order and emphasis instead, while still rendering the lockup, the <h1>, the lede, the two quick-links, and the banner landmark.
2. Priorities: the researched domain priorities as scannable cards.
3. Challenges: the pressure each priority creates, as cards.
4. Point of view and goals: tie each priority to the seller solution. Place each VERIFIED quote INSIDE the section it supports, as a styled blockquote with attribution. Never render a standalone quote list. Every quote comes from a THIRD-PARTY voice (an investor, a peer operator, or an industry post), never from the lead: never show the lead their own words. Attribute each quote with a comma before the speaker name, never an em dash.
5. Business case: a section with id="business-case". Render the metric tiles, then an inline SVG chart of the cumulative projection, then the scenario cards.
6. CTA: a section with id="book". Render the booking action from the provided booking URL when present; otherwise instruct the reader to reply to the outreach email. Use no form.
7. Footer with role="contentinfo" carrying the supplied disclaimer text.

BUSINESS CASE DETAIL
- Metric tiles: one tile per supplied metric. Show the value prominently in var(--font-display) and the label beneath. For the count-up animation, add to each tile value element a data-count attribute (the numeric part of the figure) and optional data-prefix, data-suffix, and data-decimals attributes. ALWAYS also render the exact supplied display string as the element text content, so the figure stays correct without animation.
- SVG chart: draw a bar chart of the cumulative projection series. Each point carries a height fraction in [0,1]. Pick a fixed plot height, anchor every bar to one shared baseline, and set each bar height to its fraction times that plot height, so no bar overflows the plot or runs off the top. Use the supplied fraction and invent no other scale. Label each bar with the point period and its exact display string. Add <title> and <desc> for accessibility. Theme the bars with var(--brand) and var(--accent).
- Scenario cards: one card per scenario showing its name, primary value, primary label, and secondary metric when present, all verbatim.

FIGURES
- Every dollar figure, percent, payback, and projection value is PRECOMPUTED and supplied as an exact display string. Render each string verbatim. Never invent, recompute, or reformat a figure.
- Researched prose numbers carry the same rigor. Every count, date, headcount, round size, batch name, and named quantity in the research is a checkable fact about the lead. Copy each one exactly as the research states it. Never round it, restate it as a different number, spell a digit as a different word, or invent a number the research does not state. The page reads as hand-researched only when each figure about the lead survives the lead checking it against their own knowledge.

READING TIME
- Target roughly 600 to 750 words of body copy, a read under three minutes. Prefer scannable cards and tight sentences over long paragraphs.
- Earn every section. State the seller value proposition once, then never restate it. Give each section a distinct job: the priorities name what the reader cares about, the challenges name the pressure each one creates, and the point-of-view section ties each to the solution. Do not repeat the same researched fact across sections; each card advances the argument rather than restating it. A reader who skims must meet new information in every section.

ACCESSIBILITY
- Use landmark roles (banner, main, contentinfo). Tie aria-labelledby on each section to its heading id. Provide a visually hidden .sr-only utility. Apply :focus-visible outlines on links. Respect prefers-reduced-motion for any transition.

WRITING STYLE (enforce strictly)
- No contractions. Active voice. Present tense. Strong verbs. No weak openers ("there is", "it is"). No em dashes. No AI filler words (delve, leverage, robust, seamless, unlock, transformative).
- Treat copy as design material, not decoration. Generic copy makes a page read as templated as fast as generic design does. Be specific over clever: a concrete fact from the research beats a polished abstraction every time. Let each line do exactly one job.
- Write in the prospect's own register. Mirror the language they use about themselves (the supplied self-description and priorities) rather than imposing seller vocabulary. Vary sentence rhythm so the page reads as written by a person, not assembled from a template.
- Ground every claim in the supplied research. Fabricate no facts, metrics, customers, or quotes. Use only the supplied verified quotes.`;

// Serialize the computed ValueResult into exact display strings the model renders
// verbatim and the validator confirms present. Numeric projection values ride
// alongside their display strings so the model can scale the chart geometry.
export function renderValueBlock(value: ValueResult): string {
  const lines: string[] = [];
  lines.push(`Section title: ${value.sectionTitle}`);
  lines.push(`Headline: ${value.headline.label}: ${value.headline.value}`);

  if (value.metrics && value.metrics.length > 0) {
    lines.push("Metric tiles (render each value verbatim):");
    for (const m of value.metrics) lines.push(`- ${m.label}: ${m.value}`);
  }

  if (value.projection && value.projection.series.length > 0) {
    // Precompute each bar's height fraction (its share of the tallest bar) so the
    // model never invents its own pixel scale. A cheap model that derives the scale
    // itself drifts: bars overflow the plot and the tallest gets a negative top
    // coordinate. The fraction in [0,1] makes the geometry deterministic and load
    // bearing, the same principle the page validator applies to the figures (D54).
    const maxValue = Math.max(...value.projection.series.map((p) => p.value), 0);
    lines.push(
      `Cumulative projection "${value.projection.label}" (${value.projection.unit}); draw an SVG bar chart. Each point carries a height fraction in [0,1] (its share of the tallest bar). Set each bar height to fraction times the fixed plot height, anchor every bar to one baseline, and label each bar with its display string. Use the supplied fraction; invent no scale:`,
    );
    for (const p of value.projection.series) {
      const fraction = maxValue > 0 ? Math.max(0, Math.min(1, p.value / maxValue)) : 0;
      lines.push(
        `- ${p.period}: height fraction ${fraction.toFixed(2)}, display "${p.display}"`,
      );
    }
  }

  lines.push("Scenario cards:");
  for (const s of value.scenarios) {
    const secondary = s.secondary ? `, ${s.secondary}` : "";
    lines.push(`- ${s.name}: ${s.primaryValue} (${s.primaryLabel})${secondary}`);
  }

  if (value.footnote) lines.push(`Footnote: ${value.footnote}`);
  return lines.join("\n");
}

// Construct the per-lead user prompt: the resolved token block and assets, the
// pre-escaped research text, and the fully formatted value block. The model
// renders everything, so the prompt carries no "rendered separately" caveat.
export function buildUserPrompt(
  input: BuildSiteInput,
  value: ValueResult,
  assets: PromptAssets,
): string {
  const { lead, profile, research, vertical } = input;
  const fullName = `${lead.first_name} ${lead.last_name}`;
  const role = lead.role ? escapeHtml(lead.role) : "";

  const execLines = research.executives
    .map(
      (e) =>
        `- ${escapeHtml(e.name)}, ${escapeHtml(e.title)} (owns: ${escapeHtml(e.owns)}): ${escapeHtml(e.profile)}`,
    )
    .join("\n");

  const priorityLines = research.extension.priorities
    .map(
      (p) => `- ${escapeHtml(p.domain)}: ${escapeHtml(p.pov)} Why now: ${escapeHtml(p.why_now)}`,
    )
    .join("\n");

  // Only verified quotes reach the model. The validator rejects any unverified
  // quote text on the page as a backstop.
  const verifiedQuotes = research.quotes.filter((q) => q.verified);
  // Format attribution with a comma, never an em dash: the model copies the prompt
  // wording into each <cite>, and an em dash there is an AI tell the page validator
  // now rejects (D60). The house style forbids the em dash; the prompt assembly
  // must not introduce one.
  const quoteLines =
    verifiedQuotes.length > 0
      ? verifiedQuotes
          .map((q) => `- "${escapeHtml(q.text)}", ${escapeHtml(q.speaker)}`)
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

  const disclaimer = `Mirenta prepares this page for ${escapeHtml(lead.company)}. The value figures model industry benchmarks and serve as illustration pending discovery. Confirm them against your own operational data before external use.`;

  // The active vertical may carry a hero narrative (how the page opens for this
  // segment). It rides as data so the cache-stable DESIGN_BRIEF stays neutral; a
  // vertical that omits it keeps the brief's default lockup-first hero.
  const narrativeBlock = vertical.narrativeGuidance
    ? `\n\n${vertical.narrativeGuidance}`
    : "";

  return `LEAD
${escapeHtml(fullName)}${role ? `, ${role}` : ""} at ${escapeHtml(lead.company)}.

SELLER
${escapeHtml(profile.company_name)} / ${escapeHtml(profile.product_name)}.
Value proposition: ${escapeHtml(profile.value_prop)}
${profile.positioning ? `Positioning: ${escapeHtml(profile.positioning)}` : ""}
CTA label: ${escapeHtml(profile.cta_text || "Book a 30-minute walkthrough")}

ACCOUNT
Summary: ${escapeHtml(research.account.summary)}
How they describe themselves: ${escapeHtml(research.account.self_description_language)}
Recent moves:
${recentMoves}

EXECUTIVES
${execLines || "None available."}

DOMAIN PRIORITIES (${research.extension.domains.map((d) => escapeHtml(d)).join(", ")})
${priorityLines || "None available."}

VERIFIED QUOTES (place each inside the section it supports)
${quoteLines}${narrativeBlock}

BUSINESS CASE (render these exact strings verbatim; do not recompute or reformat)
${renderValueBlock(value)}

BRAND TOKENS (paste verbatim at the top of your <style> block)
${assets.tokenBlock}

ASSETS
${assetLines.join("\n")}

REQUIRED ANCHORS
Include a hero quick-link with href="#business-case" and one with href="#book". Give the business case section id="business-case" and the CTA section id="book".

FOOTER DISCLAIMER (render verbatim in the footer)
${disclaimer}

Generate the complete page now.`;
}
