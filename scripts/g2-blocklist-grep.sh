#!/usr/bin/env bash
# G2 gate: the enterprise-sales blocklist greps to ZERO matches across the
# generated founder-facing samples (the assembled Website Builder prompt and the
# rendered one-pager). A single match exits non-zero, so the loop and CI catch any
# enterprise vocabulary that creeps back into the founder-to-founder copy.
#
# Scope (g2-blocklist memory): generated founder-facing COPY only. The rendered
# HTML is stripped of tags first, so the grep matches visible prose, never a CSS
# class, an attribute, or markup. The prompt sample greps its USER section, which
# carries the per-lead copy and the vertical's rider fields (domain/exec/input/
# narrative guidance) that ride into generation.
#
# Matching rules: word boundaries, case-insensitive. The single-word pattern guards
# against false positives ("rep" never matches "represent"/"report"/"reputation";
# "ramp" never matches "rampant"). The multi-word phrases match literally.
#
# Run: bash scripts/g2-blocklist-grep.sh
# Samples come from scripts/emit-founder-sample-prompt.ts (the prompt) and the
# render workflow (the HTML); regenerate them before a fresh run.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES_DIR="$ROOT/loop/samples"

# The canonical blocklist (g2-blocklist memory). Single words match on word
# boundaries; the phrases match literally. Keep both in lockstep with the memory
# entry and the founder-led unit test.
WORD_RE='(quota|reps?|ramp(s|ing|ed)?|enablement|procurement|RFP|MQL|SDR|BDR|territory|six-figure|enterprise-grade|account executives?)'
PHRASE_RE='(pipeline coverage|sales org|headcount plan|stakeholder buy-in|decision-maker matrix)'

total_matches=0

# Strip HTML tags and decode the handful of entities the builder escapes, so the
# grep sees visible founder-facing prose rather than markup.
strip_html() {
  sed -e 's/<[^>]*>/ /g' "$1" \
    | sed -e 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&#39;/'"'"'/g'
}

grep_sample() {
  local label="$1"
  local content="$2"
  local hits
  hits="$(printf '%s' "$content" | rg -i -w -o "$WORD_RE" 2>/dev/null; printf '%s' "$content" | rg -i -o "$PHRASE_RE" 2>/dev/null)"
  if [ -n "$hits" ]; then
    local n
    n="$(printf '%s\n' "$hits" | grep -c .)"
    total_matches=$((total_matches + n))
    echo "  FAIL  $label: $n blocklist match(es):"
    printf '%s\n' "$hits" | sort | uniq -c | sed 's/^/      /'
  else
    echo "  PASS  $label: 0 matches"
  fi
}

echo "=== G2 enterprise-blocklist grep over generated founder-facing samples ==="

# Sample 1: the assembled builder prompt (grep the USER section, the per-lead copy
# plus the vertical rider fields that shape generation).
PROMPT="$SAMPLES_DIR/builder-prompt.txt"
if [ -f "$PROMPT" ]; then
  user_section="$(sed -n '/===== USER/,$p' "$PROMPT")"
  grep_sample "builder-prompt.txt (USER section)" "$user_section"
else
  echo "  WARN  builder-prompt.txt missing; run: node scripts/emit-founder-sample-prompt.ts > loop/samples/builder-prompt.txt"
fi

# Sample 2: the rendered one-pager (tags stripped to visible copy).
HTML="$SAMPLES_DIR/founder-onepager.html"
if [ -f "$HTML" ]; then
  grep_sample "founder-onepager.html (visible copy)" "$(strip_html "$HTML")"
else
  echo "  WARN  founder-onepager.html missing; produced by the render workflow"
fi

echo "=== total blocklist matches: $total_matches ==="
if [ "$total_matches" -ne 0 ]; then
  echo "G2: FAIL"
  exit 1
fi
echo "G2: PASS"
