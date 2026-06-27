import type { ResearchObject } from "../domain/research.ts";
import type { ProductProfile } from "../domain/entities.ts";
import type { ValueResult, VerticalSpec } from "../verticals/index.ts";

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
  vertical: VerticalSpec;
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

export const DESIGN_BRIEF = `You are the Mirenta Website Builder. You generate ONE self-contained, prospect-facing HTML one-pager that presents a personalized business case. The user message supplies structured research and a precomputed value model. You render the entire document and return it through the emit_page tool.

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

ART DIRECTION
- Select EXACTLY ONE direction below. Commit to it for the whole page. Do not blend directions. Execute every move the direction names, so the page reads as one deliberate hand, not a template.
- EDITORIAL: a serif var(--font-display) at a large display size, generous line-height, a hairline var(--border) rule under each section heading, an oversized drop-initial on the hero lede, an asymmetric two-column priorities layout with a wide left margin. Signature move: a numbered running index (01, 02, 03) set in var(--muted) beside each priority heading. Value render: the value expression set very large in var(--font-display) against open whitespace, the mechanism as a single justified line beneath.
- BRUTALIST-STRUCTURED: a heavy condensed var(--font-display), tight letter-spacing, flat blocks of var(--brand) and var(--surface-dark) with squared corners (set border-radius: 0 on cards and buttons), thick 2px var(--border) lines. Signature move: a full-bleed var(--surface-dark) band (text in var(--surface-dark-fg)) for the point-of-view section, with each quote set large. Value render: the value expression in a bordered block, mono-feeling, the label in uppercase var(--muted).
- WARM-MINIMAL: a humanist sans, airy whitespace, soft var(--radius) cards on var(--surface-muted), one var(--brand-tint) wash behind the hero. Signature move: pill-shaped eyebrow tags and a single var(--accent) underline that grows on hover (CSS only, gated by prefers-reduced-motion). Value render: the value expression centered on a var(--brand-tint-strong) panel with the mechanism as warm prose below.
- TECHNICAL-MONO: a mono or grotesque var(--font-display), label-caps eyebrows (uppercase, letter-spacing, small), visible 1px var(--border) grid dividers between cards, a left 3px solid var(--accent) rule on every card and blockquote. Signature move: monospace data-style labels (KEY / VALUE rows) framing the priorities. Value render: the value expression in var(--font-display) inside a thin var(--border) frame, the footnote as a code-comment-style small line.
- MODERN-REFINED: a geometric sans var(--font-display), a restrained palette, elevated cards using var(--shadow) on var(--surface-elevated), a hero with a layered var(--brand-tint) to var(--brand-tint-strong) gradient. Signature move: the value headline sits on a contrasting var(--surface-dark) panel with var(--shadow-lg). Value render: the value expression on that elevated dark panel, prominent, the mechanism beneath in var(--text).

LAYOUT AND STYLE
- Center content in a container near 1120px max width. Hold prose to a 62 to 70 character measure.
- Use fluid clamp() type scales for headings. Use mobile-first responsive grids that collapse one to two to three columns at 720px and 1000px.
- Write a large, expressive <style> block. CSS does not count toward the word budget, so invest in type scale, spacing rhythm, and the chosen direction's details.
- Use inline SVG for decorative marks, dividers, and the wordmark. Inline SVG does not count toward the word budget. Give inline SVG no external href or src and no script.
- Build depth with CSS only: gradients from the brand tokens, var(--shadow) and var(--shadow-lg), var(--surface-elevated), and layered var(--brand-tint). Use no external image except the provided logo and favicon. Use no @import and no background-image URL.
- Apply hover and focus transitions through CSS, and honor prefers-reduced-motion. The signature move is decoration only: it must not add, rename, or remove any section, id, link, role, or figure.

REQUIRED SECTIONS, IN THIS ORDER, WITH THESE EXACT ids
1. Hero: a header element with role="banner". Include the prospect and seller lockup, an eyebrow that names the lead by name and role, an <h1>, and a short lede. Include a quick-link group with TWO links: one with href="#business-case" and one with href="#book". Both targets must resolve in this document.
2. Priorities: the researched domain priorities as scannable cards.
3. Challenges: the pressure each priority creates, as cards.
4. Point of view and goals: tie each priority to the seller solution. Place each VERIFIED respected-voice quote INSIDE the section it supports, as a styled blockquote attributed to the voice and tagged by its tier. Never render a standalone quote list.
5. Value render: a section with id="business-case". Render the value the model supplies, not a dashboard. Show the headline value expression verbatim and prominently in var(--font-display), with its label beside or beneath it. Render the one-sentence mechanism directly under the headline as plain prose. Render the footnote, when present, as small print below the mechanism. Render no metric tiles, no charts, and no scenario cards.
6. CTA: a section with id="book". Make a founder-to-founder ask in the seller's own voice. Render the booking action from the provided booking URL when present; otherwise instruct the reader to reply to the outreach email. Use no form.
7. Footer with role="contentinfo" carrying the supplied disclaimer text.

FIGURES
- The value model supplies one value expression as an exact display string. Render that string verbatim. Never invent, recompute, or reformat the figure, and add no figure the model did not supply.

READING TIME
- Target roughly 600 to 750 words of body copy, a read under three minutes. Prefer scannable cards and tight sentences over long paragraphs.

ACCESSIBILITY
- Use landmark roles (banner, main, contentinfo). Tie aria-labelledby on each section to its heading id. Provide a visually hidden .sr-only utility. Apply :focus-visible outlines on links. Respect prefers-reduced-motion for any transition.

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
  if (value.footnote) lines.push(`Footnote: ${value.footnote}`);
  return lines.join("\n");
}

export function buildUserPrompt(
  input: BuildSiteInput,
  value: ValueResult,
  assets: PromptAssets,
): string {
  const { lead, profile, research } = input;
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

REQUIRED ANCHORS
Include a hero quick-link with href="#business-case" and one with href="#book". Give the business case section id="business-case" and the CTA section id="book".

FOOTER DISCLAIMER (render verbatim in the footer)
${disclaimer}

Generate the complete page now.`;
}
