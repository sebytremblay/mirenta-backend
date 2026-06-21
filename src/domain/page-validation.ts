// Post-generation page validation (D9, D37, BACKLOG #2). The Website Builder now
// emits the entire self-contained HTML document, so the load-bearing invariants
// move to a deterministic gate at the page boundary: the document must be
// complete, it must render every precomputed value figure verbatim, it must carry
// no unsafe construct, it must reference only allow-listed external assets, it
// must never surface an unverified quote, and it must expose the required section
// anchors. A violation throws a typed PageValidationError the builder retries on
// (a corrective regeneration) and the worker finally classifies.
//
// This is reject-on-violation, not a sanitizer: the MVP rejects a noncompliant
// page rather than rewriting it, which keeps the trust boundary simple. A real
// HTML sanitizer is a documented fast-follow if reject rates run high.
//
// validatePage only inspects. injectRuntimeAssets performs the one trusted
// mutation: it welds in the fixed count-up script and a defense-in-depth meta CSP
// AFTER validation passes, so the model never authors the executable script and
// S3 still ships a page with a content-security policy (S3 sets no headers, D16).

import type { ResearchObject } from "./research.ts";
import type { ValueResult } from "../verticals/index.ts";

// A page-validation failure. `transient` separates a truncated document (the
// generation ran out of tokens) from a clean-but-noncompliant one. The worker
// retries a transient failure on the lease and fails a permanent one loudly,
// rather than publishing a broken or unsafe page.
export class PageValidationError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient = false) {
    super(message);
    this.name = "PageValidationError";
    this.transient = transient;
  }
}

// Hosts every page may reference unconditionally: Google Fonts. The builder adds
// the resolved logo, favicon, prospect site, and booking hosts per lead.
const ALWAYS_ALLOWED_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// Body copy far over budget signals the model ignored the succinctness brief.
// The target is roughly 600 to 750 words; this ceiling sits well above it so a
// normal page never trips and only a runaway essay triggers a corrective retry.
const MAX_BODY_WORDS = 1100;

export interface ValidatePageOptions {
  value: ValueResult;
  research: ResearchObject;
  // External hosts this page may reference beyond Google Fonts (logo, favicon,
  // prospect site, booking URL), resolved by the builder.
  assetHosts: string[];
  // In-document anchors that must resolve as both a section id and a quick-link,
  // for example "#business-case" and "#book".
  requiredAnchors: string[];
  // The Messages API stop_reason for this generation, used to detect truncation.
  stopReason?: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Collect every precomputed figure that must appear verbatim on the page: the
// headline value, each scenario primary value and secondary metric, each metric
// tile value, and each projection point display string. Deduplicate so a figure
// shared across blocks (a year-five total that equals the five-year net) counts
// once.
function collectRequiredFigures(value: ValueResult): string[] {
  const figs = new Set<string>();
  const add = (s: string | undefined): void => {
    if (typeof s === "string" && s.trim() !== "") figs.add(s);
  };
  add(value.headline.value);
  for (const s of value.scenarios) {
    add(s.primaryValue);
    add(s.secondary);
  }
  for (const m of value.metrics ?? []) add(m.value);
  for (const p of value.projection?.series ?? []) add(p.display);
  return [...figs];
}

// Parse the host of an absolute http(s) URL, lowercased. Returns undefined for a
// relative URL, an anchor, a mailto/tel, or anything unparseable.
function hostOf(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

// Inspect a generated document against every load-bearing invariant. Throws a
// PageValidationError on the first violation; returns nothing on success.
export function validatePage(html: string, opts: ValidatePageOptions): void {
  // 1. Completeness and truncation. A max_tokens stop or a missing closing tag
  // means the document arrived truncated: transient, retried on the lease.
  if (opts.stopReason === "max_tokens") {
    throw new PageValidationError("generation truncated at max_tokens", true);
  }
  const trimmed = html.trim();
  if (trimmed === "") {
    throw new PageValidationError("generation produced no html", true);
  }
  if (!/^<!doctype html/i.test(trimmed)) {
    throw new PageValidationError("document does not start with <!DOCTYPE html>");
  }
  if (!/<\/html>\s*$/i.test(trimmed)) {
    throw new PageValidationError("document does not end with </html> (truncated)", true);
  }
  for (const tag of ["html", "head", "body"] as const) {
    const opens = (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
    if (opens !== 1) {
      throw new PageValidationError(`expected exactly one <${tag}>, found ${opens}`);
    }
  }

  // 2. Every precomputed value figure appears verbatim. A missing figure means
  // the model dropped or reformatted a number it was told to render as-is.
  for (const fig of collectRequiredFigures(opts.value)) {
    if (!html.includes(fig)) {
      throw new PageValidationError(`required value figure missing from page: ${fig}`);
    }
  }

  // 3. No unsafe constructs. The model writes no executable or embedding markup;
  // the builder injects the one approved script after validation.
  const unsafe: Array<[RegExp, string]> = [
    [/<script[\s>]/i, "<script> tag"],
    [/<iframe[\s>]/i, "<iframe> tag"],
    [/<object[\s>]/i, "<object> tag"],
    [/<embed[\s>]/i, "<embed> tag"],
    [/<form[\s>]/i, "<form> tag"],
    [/\son[a-z]+\s*=\s*["']/i, "inline event handler"],
    [/javascript:/i, "javascript: URI"],
  ];
  for (const [re, label] of unsafe) {
    if (re.test(html)) {
      throw new PageValidationError(`forbidden ${label} in model output`);
    }
  }

  // 4. External assets resolve only to allow-listed hosts. Anything else is an
  // invented or unexpected fetch the page must not make. Strip XML namespace
  // declarations first: an inline SVG carries xmlns="http://www.w3.org/2000/svg"
  // and xmlns:xlink="http://www.w3.org/1999/xlink", which are namespace
  // identifiers the browser never fetches, not asset references. The
  // vertical-agnostic restyle renders inline SVG, so without this every page
  // would trip the scan on www.w3.org. Real href/src/url() references survive.
  const allowed = new Set(
    [...ALWAYS_ALLOWED_HOSTS, ...opts.assetHosts].map((h) => h.toLowerCase()),
  );
  const scannable = html.replace(/\bxmlns(:[a-z0-9-]+)?\s*=\s*("[^"]*"|'[^']*')/gi, " ");
  for (const url of scannable.match(/https?:\/\/[^\s"'()<>]+/gi) ?? []) {
    const host = hostOf(url);
    if (host && !allowed.has(host)) {
      throw new PageValidationError(`external asset host not allow-listed: ${host}`);
    }
  }

  // 5. No unverified quote reaches the page. The builder never sends unverified
  // quote text to the model, so this is defense in depth; the length floor avoids
  // a trivial-substring false positive on a short fragment.
  for (const q of opts.research.quotes) {
    if (!q.verified && q.text && q.text.trim().length >= 12 && html.includes(q.text)) {
      throw new PageValidationError("unverified quote text appears on the page");
    }
  }

  // 6. The hero banner and every required anchor resolve as both a section id and
  // an in-document quick-link.
  if (!/role\s*=\s*["']banner["']/i.test(html)) {
    throw new PageValidationError('hero banner (role="banner") missing');
  }
  for (const anchor of opts.requiredAnchors) {
    const id = anchor.replace(/^#/, "");
    if (!new RegExp(`id\\s*=\\s*["']${escapeRegExp(id)}["']`, "i").test(html)) {
      throw new PageValidationError(`required section id missing: #${id}`);
    }
    if (!new RegExp(`href\\s*=\\s*["']#${escapeRegExp(id)}["']`, "i").test(html)) {
      throw new PageValidationError(`required quick-link to #${id} missing`);
    }
  }

  // 7. Reading-time soft check. Strip the stylesheet and any inline SVG (its axis
  // and label text is not body copy) before counting words.
  const bodyText = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = bodyText === "" ? 0 : bodyText.split(" ").length;
  if (words > MAX_BODY_WORDS) {
    throw new PageValidationError(
      `body copy runs long (${words} words, budget under ~750); tighten the page`,
    );
  }
}

// The fixed count-up animation for the metric tiles. Mirenta owns this script
// rather than trusting model-written JS: the logic never varies across pages, so
// it stays deterministic and reviewable. It reads data-count/prefix/suffix/
// decimals attributes the model places on each tile value and respects
// prefers-reduced-motion. A tile without the attributes simply keeps its
// server-rendered text.
const COUNT_UP_SCRIPT = `<script>
(function () {
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function format(el, value) {
    var decimals = parseInt(el.dataset.decimals || '0', 10);
    return (el.dataset.prefix || '') + value.toFixed(decimals) + (el.dataset.suffix || '');
  }
  function animate(el) {
    var target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    if (prefersReduced) { el.textContent = format(el, target); return; }
    var duration = 1400, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      el.textContent = format(el, target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step); else el.textContent = format(el, target);
    }
    requestAnimationFrame(step);
  }
  var tiles = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { animate(entry.target); io.unobserve(entry.target); }
      });
    }, { threshold: 0.4 });
    tiles.forEach(function (t) { io.observe(t); });
  } else {
    tiles.forEach(function (t) { animate(t); });
  }
})();
</script>`;

// Defense-in-depth content-security policy. S3 static hosting sets no response
// headers (D16), so the page carries the policy as a meta tag: inline styles and
// the single injected inline script are permitted, images load over https, fonts
// load from Google, and framing, base, and form submission are denied.
const CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; ` +
  `font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; ` +
  `frame-ancestors 'none'; base-uri 'none'; form-action 'none'">`;

// Weld the trusted runtime assets into a validated document: the meta CSP just
// inside <head> and the count-up script just before </body>. Run this only AFTER
// validatePage passes, since it intentionally introduces the one <script> the
// validator forbids in model output.
export function injectRuntimeAssets(html: string): string {
  let out = html.replace(/<head[^>]*>/i, (m) => `${m}\n${CSP_META}`);
  out = out.replace(/<\/body>/i, `${COUNT_UP_SCRIPT}\n</body>`);
  return out;
}
