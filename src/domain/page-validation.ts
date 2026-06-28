import type { ResearchObject } from "./research.ts";
import type { ValueResult } from "./value-contract.ts";
import type { PageSpec } from "./page-spec.ts";

export class PageValidationError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient = false) {
    super(message);
    this.name = "PageValidationError";
    this.transient = transient;
  }
}

const ALWAYS_ALLOWED_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// The hard ceiling sits above the ~600-word soft target the brief sets, leaving
// slack for a content-rich lead while still rejecting a page that runs long.
const MAX_BODY_WORDS = 850;

export interface ValidatePageOptions {
  value: ValueResult;
  research: ResearchObject;
  assetHosts: string[];
  // The bespoke page spec the rendered HTML must satisfy. Validation checks the
  // HTML against the spec the designer emitted, not a hardcoded section list.
  spec: PageSpec;
  stopReason?: string | null;
}

// Extract the HTML slice belonging to a section, from the opening tag carrying
// id="<sectionId>" to the next closing </section> or </header>. A best-effort
// window good enough to confirm the value figure renders INSIDE the value-render
// section rather than anywhere on the page. Returns "" when the id is absent.
function sectionSlice(html: string, sectionId: string): string {
  const idMatch = new RegExp(`<[^>]*\\bid\\s*=\\s*["']${escapeRegExp(sectionId)}["'][^>]*>`, "i").exec(
    html,
  );
  if (!idMatch) return "";
  const start = idMatch.index;
  const rest = html.slice(start);
  const closeMatch = /<\/(section|header|main|article)\s*>/i.exec(rest);
  return closeMatch ? rest.slice(0, closeMatch.index + closeMatch[0].length) : rest;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectRequiredFigures(value: ValueResult): string[] {
  const figs = new Set<string>();
  const add = (s: string | undefined): void => {
    if (typeof s === "string" && s.trim() !== "") figs.add(s);
  };
  add(value.headline.value);
  return [...figs];
}

function hostOf(url: string): string | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

export function validatePage(html: string, opts: ValidatePageOptions): void {
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

  // Strip xmlns declarations before the host scan: an inline SVG carries
  // xmlns="http://www.w3.org/2000/svg" and xmlns:xlink, which are namespace
  // identifiers the browser never fetches, not asset references. Without this
  // every page with inline SVG trips the scan on www.w3.org.
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

  // The length floor avoids a trivial-substring false positive on a short fragment.
  for (const v of opts.research.voices) {
    const q = v.quote;
    if (!q.verified && q.text && q.text.trim().length >= 12 && html.includes(q.text)) {
      throw new PageValidationError("unverified quote text appears on the page");
    }
  }

  // Exactly one banner landmark, as the spec declares (the spec is validated to
  // carry exactly one banner section before the build runs).
  const banners = (html.match(/role\s*=\s*["']banner["']/gi) ?? []).length;
  if (banners !== 1) {
    throw new PageValidationError(`expected exactly one banner landmark, found ${banners}`);
  }

  // Every section the spec declares must render with its id, so the page matches
  // the bespoke structure the designer composed rather than drifting from it.
  for (const section of opts.spec.sections) {
    if (!new RegExp(`id\\s*=\\s*["']${escapeRegExp(section.id)}["']`, "i").test(html)) {
      throw new PageValidationError(`declared section id missing: #${section.id}`);
    }
  }

  // The CTA section the spec names must render.
  if (!new RegExp(`id\\s*=\\s*["']${escapeRegExp(opts.spec.ctaSectionId)}["']`, "i").test(html)) {
    throw new PageValidationError(`cta section missing: #${opts.spec.ctaSectionId}`);
  }

  // The value figure must appear on the page AND inside the section the spec
  // declares as the value render, so the figure lands where the designer placed
  // it rather than buried in unrelated copy. This runs after the section-id
  // checks so a missing value-render section reports the clearer structural error.
  const valueSlice = sectionSlice(html, opts.spec.valueRenderSectionId);
  for (const fig of collectRequiredFigures(opts.value)) {
    if (!html.includes(fig)) {
      throw new PageValidationError(`required value figure missing from page: ${fig}`);
    }
    if (!valueSlice.includes(fig)) {
      throw new PageValidationError(
        `value figure missing from the value-render section #${opts.spec.valueRenderSectionId}: ${fig}`,
      );
    }
  }

  // Every quick-link target the spec names must render both its section id and a
  // hero quick-link that resolves to it.
  for (const target of opts.spec.quickLinkTargets) {
    if (!new RegExp(`href\\s*=\\s*["']#${escapeRegExp(target)}["']`, "i").test(html)) {
      throw new PageValidationError(`quick-link to #${target} missing`);
    }
  }

  const bodyText = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = bodyText === "" ? 0 : bodyText.split(" ").length;
  if (words > MAX_BODY_WORDS) {
    throw new PageValidationError(
      `body copy runs long (${words} words, target near ~600); tighten the page`,
    );
  }
}

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

const CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; ` +
  `font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; ` +
  `frame-ancestors 'none'; base-uri 'none'; form-action 'none'">`;

// Run this only AFTER validatePage passes, since it intentionally introduces the
// one <script> the validator forbids in model output.
export function injectRuntimeAssets(html: string): string {
  let out = html.replace(/<head[^>]*>/i, (m) => `${m}\n${CSP_META}`);
  out = out.replace(/<\/body>/i, `${COUNT_UP_SCRIPT}\n</body>`);
  return out;
}
