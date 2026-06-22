export const meta = {
  name: 'founder-sample-render-and-review-v5',
  description: 'Iteration 5 (final of 5): re-render from the brief that now pins researched prose numbers verbatim, gate the render deterministically for fact fidelity and house style before scoring, then re-score with a hard five-reviewer panel given the complete ground-truth fact set',
  phases: [
    { title: 'Render', detail: 'Haiku-tier builder renders the page; a deterministic fidelity gate retries until the count, the figures, and the no-em-dash rule all hold' },
    { title: 'Review', detail: 'five independent founder personas (three adversarial, two original) score the G3 rubric against ground truth' },
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
    arithmeticReconciles: { type: 'boolean', description: 'Did every scenario value/multiple return the $23K cost, the hero multiple equal the Expected card, and $41K + $58K = $99K?' },
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
  required: ['persona', 'dimensions', 'weightedScore', 'arithmeticReconciles', 'feedback', 'blockerCount', 'verdict'],
}

// The figures the value model computes, which the page must carry verbatim.
const REQUIRED_FIGURES = ['$66K', '$99K', '$126K', '2.9x', '4.3x', '5.5x', '$23K', '2.8 mo', '384 hrs', '$41K', '$58K']

// Deterministic fidelity gate over rendered HTML. Catches the exact defect class the
// verification panel surfaced (a researched count paraphrased to a wrong number) plus
// house-style and figure-verbatim regressions, all of which a regex settles for free
// so the human-judged panel never spends its scrutiny on a mechanical slip.
function gateHtml(html) {
  const failures = []
  // The research states 40 design partners. Require it and reject any other count.
  if (!/\b(40|forty)\b[^.<]{0,24}design[\s-]?partner/i.test(html)) {
    failures.push('the "40 design partners" figure is missing or not stated as 40')
  }
  const wrongCount = html.match(/\b(fifty|sixty|thirty|twenty|seventy|forty-?five|thirty-?five|twenty-?five|50|60|30|20|70|45|35|25)\b[^.<]{0,24}design[\s-]?partner/i)
  if (wrongCount) failures.push(`a wrong count modifies "design partner": "${wrongCount[0].trim()}"`)
  // House style: no em dash or en dash anywhere, including the <title>.
  const dash = html.match(/[—–]/)
  if (dash) failures.push('an em dash or en dash appears (house style forbids both)')
  // Every computed figure renders verbatim.
  for (const fig of REQUIRED_FIGURES) {
    if (!html.includes(fig)) failures.push(`missing computed figure ${fig}`)
  }
  // The footnote split sentence is the proof the numbers tie out; keep it intact.
  if (!/\$41K[^.]*deals[\s\S]{0,80}\$58K[^.]*(founder )?hours/i.test(html) &&
      !/\$58K[^.]*hours[\s\S]{0,80}\$41K[^.]*deals/i.test(html)) {
    failures.push('the footnote does not name the $41K-deals / $58K-hours split')
  }
  return failures
}

const RENDER_PROMPT = `You ARE the Mirenta Website Builder, a deterministic HTML generator. Read the file at ${PROMPT_PATH}. It has two sections: "===== SYSTEM (DESIGN_BRIEF) =====" is your system brief and "===== USER (per-lead prompt) =====" is the per-lead data (lead, seller, account, priorities, the HERO NARRATIVE block, the precomputed BUSINESS CASE figures, brand tokens, assets, disclaimer).

Produce the ONE complete self-contained HTML one-pager exactly as that brief and prompt instruct. Follow every rule. Pay attention to these in particular:

1. FACT FIDELITY. Every number, date, headcount, round size, and named quantity in the research is a checkable fact about Cedar. Copy each EXACTLY as the research states it. The research says FORTY (40) design-partner companies; write 40, never fifty or any other count. The seed round is $4.5M led by Basis Set Ventures in March 2026; the YC batch is W25; the founding team is three people. Never round, restate, or invent any of these. A single wrong number about the lead's own company is the tell that this page is automation, not hand research.

2. NO EM DASH ANYWHERE, including the <title>. Use a colon, a comma, or a period instead. The page must contain no "—" and no "–" character.

3. NO CHART. The BUSINESS CASE supplies NO cumulative projection series. The DESIGN_BRIEF describes an SVG chart, but you render a chart ONLY when projection points are supplied. None are, so render NO SVG chart. Render the three metric tiles (Payback period 2.8 mo, Hours returned per year 384 hrs, First-year cost $23K) and the three scenario cards (Conservative $66K / 2.9x, Expected $99K / 4.3x, Aggressive $126K / 5.5x), all verbatim. Render the footnote verbatim, including the sentence that splits the $99K into $41K from deals won and $58K from the 384 founder hours. Do not drop or paraphrase that split sentence; it is the proof the numbers tie out.

4. NO REPETITION. Each of the seven sections does a DISTINCT job and carries NEW information. State the seller value proposition ONCE, in the hero. Do NOT reuse the same researched fact in more than one section: use each concrete fact (the 19-day bank-account wait, the YC W25 batch, the 40 design partners, the Basis Set seed round, the build-in-public updates) AT MOST ONCE across the whole page. Priorities name what the founder is chasing, challenges name a distinct obstacle to each, and the POV ties each obstacle to a specific mechanic of the product. Keep the body to 550 to 700 words.

5. PEER VOICE, no vendor seams. Read founder to founder. Avoid generated-marketing phrasing ("free back your hours", "unlock", "supercharge"). For the CTA heading, invite a plain working session founder to founder; do not concede the on-page numbers are not real.

Also follow the standard rules: all CSS in one <style> block with the brand token :root pasted verbatim; no <script>, <form>, <iframe>; the seven required sections in order with the exact ids (#business-case, #book); open the hero per the HERO NARRATIVE block (mirror line first referencing only the lead with zero seller/product tokens, then one lived moment from the recent moves, then the seller in first person); render no quotes (none supplied); enforce the writing style strictly (no contractions, active voice, present tense, no em dashes, no AI filler). The footer carries the disclaimer verbatim.

Do not explore the repository. Read only that one file. Return the full document in the html field.`

phase('Render')
// Render, then run the deterministic gate. Retry the render (not the iteration) until
// the cheap mechanical gate passes, so a stochastic count slip does not burn the human
// review. Vary the label per attempt since randomness is unavailable in scripts.
let html = null
let renderNotes = ''
let gateFailures = ['no render produced']
for (let attempt = 1; attempt <= 3; attempt++) {
  const render = await agent(RENDER_PROMPT, {
    schema: HTML_SCHEMA,
    phase: 'Render',
    label: `builder:haiku:v5:attempt-${attempt}`,
    model: 'haiku',
    effort: 'low',
  })
  if (!render || !render.html || render.html.length < 800) {
    gateFailures = ['render failed or returned too little HTML']
    continue
  }
  const failures = gateHtml(render.html)
  log(`attempt ${attempt}: rendered ${render.html.length} bytes, ${failures.length} gate failures${failures.length ? ': ' + failures.join('; ') : ''}`)
  if (failures.length === 0) {
    html = render.html
    renderNotes = render.notes ?? ''
    gateFailures = []
    break
  }
  // Keep the latest attempt as a fallback even if the gate is not clean.
  html = render.html
  renderNotes = render.notes ?? ''
  gateFailures = failures
}

if (!html) {
  return { error: 'render failed', gateFailures }
}

// Ground-truth fact set every reviewer holds. A real founder reading a cold page knows
// their own company; giving the persona the true facts lets it flag any page number or
// claim that CONTRADICTS or EXCEEDS the truth (a real fabrication) without false-flagging
// a grounded detail it simply was not told about. This corrects the prior panel brief,
// which omitted the 19-day detail and so misread a researched fact as invented.
const GROUND_TRUTH = `GROUND TRUTH about you and Cedar (these are the real, researched facts; treat them as true):
- Cedar is a seed-stage fintech building Cedar Cash, a banking and corporate-card product for early-stage founders.
- The founding team is three people. You, Devin Park, are Co-Founder and CEO; you own product direction and the first sales conversations.
- Cedar raised a $4.5M seed round led by Basis Set Ventures in March 2026.
- Cedar shipped Cedar Cash to its first 40 design-partner companies, won through a Y Combinator W25 batch referral loop where one founder introduces the next.
- You co-founded Cedar after waiting nineteen days to open a business bank account as a first-time founder. You sold the first 40 design partners personally through warm YC introductions, you write every outbound message by hand, and you post weekly build-in-public updates.
- No third-party or investor quote exists for this page; the team rejected fabricated quotes, so the page carries none by design.

Because you know these facts, judge the page two ways: reward it when it reflects them accurately and specifically, and treat as a FABRICATION BLOCKER any number, date, headcount, round size, or named fact on the page that CONTRADICTS or EXCEEDS this truth (for example a design-partner count other than 40, a wrong round size, or an investor quote). A vague claim that could fit any seed founder is not a blocker but scores low on Specificity.`

phase('Review')
const PERSONAS = [
  // The three fresh adversarial personas that caught the iteration-4 defect.
  {
    key: 'numbers-first',
    persona: 'A numbers-first founder who was a quant before founding. You trust nothing you cannot recompute. You open every cold page straight to the business case and reverse-engineer the math before you read a word of prose. A single figure that does not tie out ends the read.',
  },
  {
    key: 'been-burned',
    persona: 'A founder who has been burned by three vendor tools that overpromised. You are hypersensitive to manufactured trust signals, fake personalization, and value math that inflates by counting soft savings as hard cash. You assume the page is lying until each claim proves itself.',
  },
  {
    key: 'design-partner-stage',
    persona: 'An early-stage founder who buys from other founders and has sent plenty of cold outbound yourself. You know exactly what real founder-to-founder outreach reads like and you can smell a generated template instantly. You care most whether this recognizes your actual day and sounds like a peer, not a pitch.',
  },
  // The two original G3 personas, for continuity with the recorded gate.
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

You are reviewing a generated one-pager that a founder (Mirenta, selling outbound personalization) sent you cold. Mirenta runs founder-led sales to other founders, repositioning away from enterprise language. The lead on the page is you: Devin Park, Co-Founder and CEO at Cedar, a seed-stage fintech building banking for early-stage founders.

${GROUND_TRUTH}

Score the page on this exact five-dimension rubric, each 0-10:
- Recognition (weight 0.30): a 10 names the founder's actual lived problem in the first two lines; a 0 is a generic "grow your sales" opener.
- Specificity (weight 0.25): a 10 references your real, named, checkable context (Cedar Cash, Basis Set, the YC W25 batch, the 40 design partners, a specific lived detail); a 0 is a mad-libs template with a slotted name. Reward concrete facts only another founder or a researcher would know; penalize anything that could fit any seed fintech founder.
- Credibility (weight 0.20): a 10 offers proof a founder trusts AND shows figures that reconcile. This page deliberately carries NO third-party quote. Judge credibility on what IS there: the seller's honest first-person admission of being at the same stage; the computed outcomes (a first-year return multiple, a payback in months, hours returned, a first-year cost), explicitly labeled estimates pending discovery; and whether the figures RECONCILE. DO THE ARITHMETIC ON THE PAGE: divide each scenario card's displayed value created by its displayed multiple and confirm it returns the displayed first-year cost tile ($66K/2.9x, $99K/4.3x, $126K/5.5x should each land on ~$23K); confirm the hero headline multiple equals the Expected card (4.3x); and confirm the footnote split adds up ($41K from deals + $58K from founder hours = $99K). Set arithmeticReconciles accordingly. Reward figures that tie out to the precision shown; penalize anything invented, unfalsifiable, internally inconsistent, or rounded so it does not tie out.
- Brevity (weight 0.15): a 10 lets a busy founder get the point in under 20 seconds; a 0 is walls of text with a buried lede. Penalize repetition: the same fact or idea restated across sections.
- Tone (weight 0.10): a 10 is founder-to-founder peer voice with zero salesiness; a 0 is a corporate vendor pitch.

A blocker is any single thing that would make you, as this founder, close the tab: a factual error (a page fact that contradicts or exceeds the ground truth above), a fabricated or unverifiable quote, a wrong-domain reference, a salesy/generic opener, or numbers that visibly do not add up. List every blocker.

Read the HTML as rendered copy. Verify the figures reconcile (do the arithmetic above). Compute weightedScore = recognition*0.30 + specificity*0.25 + credibility*0.20 + brevity*0.15 + tone*0.10. Be a hard grader. Return your scores, arithmeticReconciles, every feedback item tagged blocker/major/minor, the blocker count, and a one-sentence verdict.

THE RENDERED PAGE (HTML):
${html}`,
    { schema: REVIEW_SCHEMA, phase: 'Review', label: `review:${p.key}:v5` },
  ).then((r) => (r ? { ...r, key: p.key } : null)),
))

const scored = reviews.filter(Boolean)
return { html, renderNotes, gateFailures, reviews: scored }
