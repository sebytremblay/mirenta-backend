export const meta = {
  name: 'founder-loop-final-verification',
  description: 'Adversarially verify the G3 pass is robust with a fresh diverse reviewer panel on the committed page, and run a completeness critic over all six gates against repo state, before shipping the G5 report',
  phases: [
    { title: 'Verify', detail: 'a fresh diverse founder panel re-scores the committed page; a completeness critic audits every gate against the repo' },
  ],
}

const HTML_PATH = '/Users/stremblay/Desktop/personal/mirenta/mirenta-backend/loop/samples/founder-onepager.html'
const ROOT = '/Users/stremblay/Desktop/personal/mirenta/mirenta-backend'

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
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
    weightedScore: { type: 'number' },
    arithmeticReconciles: { type: 'boolean', description: 'Did dividing each displayed value created by its displayed multiple return the displayed $23K cost, and the hero multiple equal the Expected card, and $41K + $58K = $99K?' },
    blockerCount: { type: 'number' },
    blockers: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['lens', 'dimensions', 'weightedScore', 'arithmeticReconciles', 'blockerCount', 'blockers', 'verdict'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    gates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gate: { type: 'string', description: 'G1 | BUILD | G2 | G3 | G4 | G5' },
          substantiated: { type: 'boolean' },
          evidence: { type: 'string', description: 'the concrete artifact (file, test, exit code) that substantiates or fails the gate' },
          gap: { type: 'string', description: 'what is missing or wrong, or empty' },
        },
        required: ['gate', 'substantiated', 'evidence', 'gap'],
      },
    },
    missingWork: { type: 'array', items: { type: 'string' }, description: 'anything the loop claims done but is not, or any house-style/consistency defect in the committed work' },
    overallReady: { type: 'boolean', description: 'true only if every gate G1-G5 plus BUILD is substantiated' },
  },
  required: ['gates', 'missingWork', 'overallReady'],
}

phase('Verify')

const LENSES = [
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
]

const verify = await parallel([
  // Three fresh, diverse reviewers re-score the SAME committed page to confirm the
  // gate holds with margin and is not an artifact of the two original personas.
  ...LENSES.map((l) => () =>
    agent(
      `${l.persona}

Read the file at ${HTML_PATH}. It is a cold one-pager that a founder (Mirenta, selling outbound personalization founder-to-founder) sent you. You are the lead on the page: Devin Park, Co-Founder and CEO at Cedar, a seed-stage fintech building banking for early-stage founders (a $4.5M seed led by Basis Set last March, first 40 design partners out of YC W25, you write every outbound message by hand).

Score the page on this rubric, each dimension 0-10, then compute weightedScore = recognition*0.30 + specificity*0.25 + credibility*0.20 + brevity*0.15 + tone*0.10:
- Recognition (0.30): does it name your actual lived problem in the first two lines?
- Specificity (0.25): does it cite real, checkable Cedar facts only a researcher would know, not a slotted template?
- Credibility (0.20): are the figures honest and do they RECONCILE? DO THE ARITHMETIC: divide each scenario card's displayed value created by its displayed multiple ($66K/2.9x, $99K/4.3x, $126K/5.5x) and confirm each returns the displayed $23K first-year-cost tile; confirm the hero headline multiple equals the Expected card (4.3x); confirm the footnote split $41K from deals + $58K from founder hours = $99K. Note the page carries NO third-party quote by design (the team rejected fabricated quotes). Set arithmeticReconciles to whether every check above holds.
- Brevity (0.15): can a busy founder get the point in under 20 seconds? Penalize repetition.
- Tone (0.10): founder-to-founder peer voice, zero salesiness?

A blocker is anything that makes you close the tab: a factual error, a fabricated/unverifiable quote, a wrong-domain reference, a salesy/generic opener, or numbers that visibly do not add up. List every blocker. Be a hard grader. Return your lens name, scores, weightedScore, arithmeticReconciles, blocker count, blockers, and a one-sentence verdict.`,
      { schema: REVIEW_SCHEMA, phase: 'Verify', label: `verify-review:${l.key}` },
    ).then((r) => (r ? { ...r, key: l.key } : null)),
  ),
  // A completeness critic audits every acceptance gate against the actual repo,
  // not against the loop's own claims about itself.
  () =>
    agent(
      `You are a completeness critic auditing whether an overnight repositioning loop genuinely met its six acceptance gates. Work from the repository at ${ROOT}, not from any summary. Use read-only inspection plus running the build commands.

The gates:
- G1 ROI bounds: the founder-led headline multiple stays in [1x, 20x], payback is positive and finite under 24 months, and the headcount input never exceeds 5, across a broad sweep with zero breaches. Evidence lives in tests/unit/founder-led-g1-harness.test.ts and src/verticals/founder-led-sales.ts. Run \`node --test tests/unit/founder-led-g1-harness.test.ts\` and confirm it passes.
- BUILD: \`npm test\` (no skips) and \`npm run typecheck\` both exit 0. Run both and report the exit codes and the pass/fail/skip counts.
- G2: the enterprise blocklist greps to zero matches across the generated founder-facing samples. Run \`bash scripts/g2-blocklist-grep.sh\` and report its exit code.
- G3: the founder rubric passed (this is human-judged by reviewers; just confirm the loop ledger records a pass with both reviewers >= 8.0, every dimension >= 6, spread <= 1.5, zero blockers, within 5 iterations). Read loop/LEDGER.md and loop/memory/g3-iterations.md.
- G4: every changed decision is cited in DECISIONS.md and conflicts are logged open. Confirm D59 exists in DECISIONS.md, cites the founder-led reposition, and logs its open conflicts. Confirm the founder-led code cites D59.
- G5: a self-contained HTML report ships under loop/. Check whether one exists yet (it may not, since you are running just before it is written).

Also scan the committed founder-led work for defects: house-style violations (contractions, em dashes) in DECISIONS.md D59 and in src/verticals/founder-led-sales.ts; any figure in the committed builder-prompt.txt sample that does not match what the value model computes; and any test that asserts a stale value. Use ripgrep, not grep.

For each gate return whether it is substantiated, the concrete evidence (file, test name, exit code), and any gap. List any missing or defective work in missingWork. Set overallReady true only if G1-G4 plus BUILD are substantiated (G5 may legitimately be pending).`,
      { schema: AUDIT_SCHEMA, phase: 'Verify', label: 'completeness-critic', agentType: 'general-purpose' },
    ),
])

const reviews = verify.slice(0, LENSES.length).filter(Boolean)
const audit = verify[LENSES.length]

return { reviews, audit }
