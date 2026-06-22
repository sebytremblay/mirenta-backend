export const meta = {
  name: 'founder-sample-render-and-review-v2',
  description: 'Iteration 2: re-render the founder one-pager from the revised prompt (fixed chart geometry, anti-repetition, grounded footnote), then two founder reviewers score the G3 rubric',
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
  `You ARE the Mirenta Website Builder, a deterministic HTML generator. Read the file at ${PROMPT_PATH}. It contains two sections separated by markers: "===== SYSTEM (DESIGN_BRIEF) =====" is your system brief (the output contract, required sections, brand rules, writing style) and "===== USER (per-lead prompt) =====" is the per-lead data (lead, seller, account, priorities, the HERO NARRATIVE block, the precomputed BUSINESS CASE figures, brand tokens, assets, disclaimer).

Produce the ONE complete self-contained HTML one-pager exactly as that brief and prompt instruct. Follow every rule precisely. Pay special attention to these, which a prior render got wrong:

1. SVG CHART GEOMETRY. The projection points now carry a HEIGHT FRACTION in [0,1] (each bar's share of the tallest bar). Pick a fixed plot height (for example 200px). Anchor EVERY bar to ONE shared baseline (the same y for the bottom of every bar). Set each bar's height to fraction * plotHeight, and its top y to baseline - height. No bar may have a negative coordinate, overflow the plot, or exceed the tallest. The tallest bar (fraction 1.00) reaches the top gridline; the smallest (fraction 0.13) is short. Use ONLY the supplied fractions; invent no other scale.

2. NO REPETITION. State the seller value proposition ONCE. Do not restate it in the hero lede, the POV section, and the CTA. Do not repeat the same researched fact (for example "shipped the first corporate-card product to design partners") across the hero, priorities, and POV. Give each of the seven sections a DISTINCT job and new information. A reader who skims must meet something new in every section. Keep the page tight: roughly 600 to 750 words of body.

3. Render every supplied figure VERBATIM (the headline "4.2x", payback "2.8 mo", "384 hrs", "$77K", the projection display strings, the scenario cards). Render the footnote verbatim; it now states the value-math basis.

Also follow all the standard rules: all CSS in one <style> block with the brand token :root pasted verbatim; no <script>, <form>, <iframe>; the seven required sections in order with the exact ids (#business-case, #book); open the hero per the HERO NARRATIVE block (mirror line first referencing only the lead with zero seller/product tokens, then one lived moment from the recent moves, then the seller in first person); render no quotes (none supplied); enforce the writing style strictly (no contractions, active voice, present tense, no em dashes, no AI filler like "free back your hours"). The footer carries the disclaimer verbatim.

Do not explore the rest of the repository. Read only that one file. Return the full document in the html field.`,
  { schema: HTML_SCHEMA, phase: 'Render', label: 'builder:haiku:v2', model: 'haiku', effort: 'low' },
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
    persona: 'A bootstrapped technical solo founder. You write your own outbound between shipping code. You are allergic to fluff and marketing speak, and you instantly distrust any claim you cannot verify or any number that smells invented. You care whether the page recognizes the actual problem you wake up thinking about and whether the time/ROI math is honest and checkable.',
  },
  {
    key: 'commercial-cofounder',
    persona: 'A commercial co-founder who raised a seed round and runs go-to-market while the team is tiny. You read positioning for a living. You close the tab the instant a page reads like a vendor broadcast, name-drops a fact that is wrong for your domain, or fakes a trust signal. You weigh whether this reads founder-to-founder, peer voice, and whether the credibility rests on something real.',
  },
]

const reviews = await parallel(PERSONAS.map((p) => () =>
  agent(
    `${p.persona}

You are reviewing a generated one-pager that a founder (Mirenta, selling outbound personalization) sent you cold. Mirenta runs founder-led sales to other founders and is repositioning away from enterprise sales language. The lead on the page is you-as-Devin-Park, Co-Founder and CEO at Cedar, a seed-stage fintech building banking for early-stage founders.

Score the page on this exact five-dimension rubric, each dimension 0-10:
- Recognition (weight 0.30): a 10 names the founder's actual lived problem in the first two lines; a 0 is a generic "grow your sales" opener.
- Specificity (weight 0.25): a 10 references the lead's real domain, stage, and named context; a 0 is a mad-libs template with a slotted name.
- Credibility (weight 0.20): a 10 offers proof a founder trusts (named investor, peer, or a concrete, checkable outcome); a 0 is vague claims with no named source. NOTE: this page deliberately carries NO third-party quote, because the team rejected fabricated investor quotes as a trust-killer. Judge credibility on what IS there: the seller's honest first-person admission of being at the same stage, the concrete computed outcomes (a first-year multiple, a payback in months, hours returned, a five-year value projection, all labeled as estimates pending discovery, with a footnote that now states the value-math basis), whether the projection chart renders correctly, and whether the page reflects the lead's own real track record. Reward honest, checkable, clearly-estimated figures and a correctly drawn chart; penalize anything that reads invented, unfalsifiable, or visibly broken.
- Brevity (weight 0.15): a 10 lets a busy founder get the point in under 20 seconds; a 0 is walls of text with a buried lede. Penalize repetition: the same fact or value proposition restated across sections.
- Tone (weight 0.10): a 10 is founder-to-founder peer voice with zero salesiness; a 0 is a corporate vendor pitch.

A blocker is any single thing that would make you, as this founder, close the tab: a factual error, a fabricated or unverifiable quote, a wrong-domain reference, or a salesy/generic opener. List every blocker.

Read the HTML below as rendered copy AND inspect the SVG chart geometry (check that bars share one baseline, none has a negative coordinate, none overflows the plot, and bar heights are ordered the same as their labeled values). Compute weightedScore = recognition*0.30 + specificity*0.25 + credibility*0.20 + brevity*0.15 + tone*0.10. Be a hard grader: you have seen a thousand cold pages and click off most. Return your scores, every feedback item tagged blocker/major/minor, the blocker count, and a one-sentence verdict.

THE RENDERED PAGE (HTML):
${html}`,
    { schema: REVIEW_SCHEMA, phase: 'Review', label: `review:${p.key}:v2` },
  ).then((r) => (r ? { ...r, key: p.key } : null)),
))

return { html, reviews: reviews.filter(Boolean), renderNotes: render.notes ?? '' }
