export const meta = {
  name: 'founder-sample-render-and-review-v3',
  description: 'Iteration 3: re-render from the revised value model (no projection chart, reconciling figures, value-created + cost tile) and re-run the G3 founder review',
  phases: [
    { title: 'Render', detail: 'Haiku-tier builder renders the page from the revised assembled prompt' },
    { title: 'Review', detail: 'two independent founder personas score the G3 rubric adversarially' },
  ],
}

const PROMPT_PATH = '/Users/stremblay/Desktop/personal/mirenta/mirenta-backend/loop/samples/builder-prompt.txt'

const HTML_SCHEMA = {
  type: 'object',
  properties: {
    html: { type: 'string', description: 'The complete self-contained HTML document, from <!DOCTYPE html> through </html>.' },
    notes: { type: 'string', description: 'One line on any contract item you could not satisfy, or empty.' },
  },
  required: ['html'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    persona: { type: 'string' },
    dimensions: {
      type: 'object',
      properties: {
        recognition: { type: 'number' },
        specificity: { type: 'number' },
        credibility: { type: 'number' },
        brevity: { type: 'number' },
        tone: { type: 'number' },
      },
      required: ['recognition', 'specificity', 'credibility', 'brevity', 'tone'],
    },
    weightedScore: { type: 'number', description: 'Recognition*0.30 + Specificity*0.25 + Credibility*0.20 + Brevity*0.15 + Tone*0.10' },
    feedback: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          note: { type: 'string' },
        },
        required: ['severity', 'note'],
      },
    },
    blockerCount: { type: 'number' },
    verdict: { type: 'string', description: 'One sentence: would this founder keep reading or close the tab, and why.' },
  },
  required: ['persona', 'dimensions', 'weightedScore', 'feedback', 'blockerCount', 'verdict'],
}

phase('Render')
const render = await agent(
  `You ARE the Mirenta Website Builder, a deterministic HTML generator. Read the file at ${PROMPT_PATH}. It has two sections: "===== SYSTEM (DESIGN_BRIEF) =====" is your system brief and "===== USER (per-lead prompt) =====" is the per-lead data (lead, seller, account, priorities, the HERO NARRATIVE block, the precomputed BUSINESS CASE figures, brand tokens, assets, disclaimer).

Produce the ONE complete self-contained HTML one-pager exactly as that brief and prompt instruct. Follow every rule. Pay attention to these in particular:

1. NO CHART. The BUSINESS CASE in the per-lead prompt supplies NO cumulative projection series this time, only metric tiles and scenario cards. The DESIGN_BRIEF describes an SVG chart, but you render a chart ONLY when projection points are supplied. None are supplied, so render NO SVG chart. Render the three metric tiles (Payback period 2.8 mo, Hours returned per year 384 hrs, First-year cost $23K) and the three scenario cards (Conservative $66K / 2.8x, Expected $99K / 4.2x, Aggressive $126K / 5.4x), all verbatim. Render the footnote verbatim.

2. NO REPETITION. State the seller value proposition ONCE (in the hero). Do not restate it in the lede, the POV section, or the CTA. Do not repeat the same researched fact (for example "shipped the first corporate-card product to design partners") in more than one section. Give each of the seven sections a DISTINCT job and new information. A skimming reader must meet something new in every section. Keep the body to roughly 600 to 750 words.

3. PEER VOICE, no vendor seams. Avoid phrases that read like generated marketing copy. Do not write "free back your hours" or similar. For the CTA heading, do not write anything that concedes the on-page numbers are not real (no "ready to run the numbers with real data"); instead invite a working session plainly, founder to founder.

Also follow the standard rules: all CSS in one <style> block with the brand token :root pasted verbatim; no <script>, <form>, <iframe>; the seven required sections in order with the exact ids (#business-case, #book); open the hero per the HERO NARRATIVE block (mirror line first referencing only the lead with zero seller/product tokens, then one lived moment from the recent moves, then the seller in first person); render no quotes (none supplied); enforce the writing style strictly (no contractions, active voice, present tense, no em dashes, no AI filler). The footer carries the disclaimer verbatim.

Do not explore the repository. Read only that one file. Return the full document in the html field.`,
  { schema: HTML_SCHEMA, phase: 'Render', label: 'builder:haiku:v3', model: 'haiku', effort: 'low' },
)

if (!render || !render.html || render.html.length < 800) {
  return { error: 'render failed', render }
}

log(`rendered ${render.html.length} bytes`)
const html = render.html

phase('Review')
const PERSONAS = [
  {
    key: 'technical-solo',
    persona: 'A bootstrapped technical solo founder. You write your own outbound between shipping code. You are allergic to fluff and marketing speak, and you instantly distrust any claim you cannot verify or any number that smells invented or does not tie out. You care whether the page recognizes the actual problem you wake up thinking about and whether the time/ROI math is honest and checkable.',
  },
  {
    key: 'commercial-cofounder',
    persona: 'A commercial co-founder who raised a seed round and runs go-to-market while the team is tiny. You read positioning for a living. You close the tab the instant a page reads like a vendor broadcast, name-drops a fact wrong for your domain, fakes a trust signal, or shows numbers that do not reconcile. You weigh whether this reads founder-to-founder, peer voice, and whether the credibility rests on something real.',
  },
]

const reviews = await parallel(PERSONAS.map((p) => () =>
  agent(
    `${p.persona}

You are reviewing a generated one-pager that a founder (Mirenta, selling outbound personalization) sent you cold. Mirenta runs founder-led sales to other founders, repositioning away from enterprise language. The lead on the page is you-as-Devin-Park, Co-Founder and CEO at Cedar, a seed-stage fintech building banking for early-stage founders.

Score the page on this exact five-dimension rubric, each 0-10:
- Recognition (weight 0.30): a 10 names the founder's actual lived problem in the first two lines; a 0 is a generic "grow your sales" opener.
- Specificity (weight 0.25): a 10 references the lead's real domain, stage, and named context; a 0 is a mad-libs template with a slotted name.
- Credibility (weight 0.20): a 10 offers proof a founder trusts (a concrete, checkable outcome or named source); a 0 is vague claims. NOTE: this page deliberately carries NO third-party quote (the team rejected fabricated investor quotes as a trust-killer). Judge credibility on what IS there: the seller's honest first-person admission of being at the same stage; the computed outcomes (a first-year return multiple, a payback in months, hours returned, and a first-year cost), explicitly labeled estimates pending discovery, with a footnote stating the value-math basis; and whether the figures RECONCILE. Check the math: value created divided by the return multiple should equal the first-year cost in every scenario card, and payback should match cost over monthly value. Reward figures that tie out and are honestly labeled; penalize anything invented, unfalsifiable, or internally inconsistent.
- Brevity (weight 0.15): a 10 lets a busy founder get the point in under 20 seconds; a 0 is walls of text with a buried lede. Penalize repetition.
- Tone (weight 0.10): a 10 is founder-to-founder peer voice with zero salesiness; a 0 is a corporate vendor pitch.

A blocker is any single thing that would make you, as this founder, close the tab: a factual error, a fabricated or unverifiable quote, a wrong-domain reference, a salesy/generic opener, or numbers that visibly do not add up. List every blocker.

Read the HTML as rendered copy. Verify the figures reconcile (do the arithmetic). Compute weightedScore = recognition*0.30 + specificity*0.25 + credibility*0.20 + brevity*0.15 + tone*0.10. Be a hard grader. Return your scores, every feedback item tagged blocker/major/minor, the blocker count, and a one-sentence verdict.

THE RENDERED PAGE (HTML):
${html}`,
    { schema: REVIEW_SCHEMA, phase: 'Review', label: `review:${p.key}:v3` },
  ).then((r) => (r ? { ...r, key: p.key } : null)),
))

return { html, reviews: reviews.filter(Boolean), renderNotes: render.notes ?? '' }
