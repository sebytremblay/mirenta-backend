import type { ResearchObject } from "./research.ts";
import type { ValueResult } from "../verticals/index.ts";

export class PageValidationError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient = false) {
    super(message);
    this.name = "PageValidationError";
    this.transient = transient;
  }
}

const ALWAYS_ALLOWED_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const MAX_BODY_WORDS = 1100;

export interface ValidatePageOptions {
  value: ValueResult;
  research: ResearchObject;
  assetHosts: string[];
  requiredAnchors: string[];
  stopReason?: string | null;
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
  for (const s of value.scenarios) {
    add(s.primaryValue);
    add(s.secondary);
  }
  for (const m of value.metrics ?? []) add(m.value);
  for (const p of value.projection?.series ?? []) add(p.display);
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

  for (const fig of collectRequiredFigures(opts.value)) {
    if (!html.includes(fig)) {
      throw new PageValidationError(`required value figure missing from page: ${fig}`);
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
  for (const q of opts.research.quotes) {
    if (!q.verified && q.text && q.text.trim().length >= 12 && html.includes(q.text)) {
      throw new PageValidationError("unverified quote text appears on the page");
    }
  }

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
