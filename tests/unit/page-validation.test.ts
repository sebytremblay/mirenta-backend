import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePage,
  injectRuntimeAssets,
  PageValidationError,
  type ValidatePageOptions,
} from "../../src/domain/page-validation.ts";
import type { ValueResult } from "../../src/verticals/index.ts";
import type { ResearchObject } from "../../src/domain/research.ts";

const value: ValueResult = {
  sectionTitle: "What this frees up",
  headline: { label: "Founder time reclaimed", value: "~4 to 6 founder-hours reclaimed each week" },
  mechanism: "A seed-stage founder runs go-to-market by hand.",
  footnote: "Drawn from a stage-band benchmark.",
};

const research: ResearchObject = {
  vertical: "sales_marketing",
  account: { summary: "An early-stage startup.", recent_moves: [], self_description_language: "We build." },
  voices: [
    {
      name: "CEO",
      identity: "the founder",
      tier: "self",
      quote: { text: "We invest in our people every day.", source_url: "https://x.test/a", verified: true },
    },
    {
      name: "Rumor",
      identity: "a blog",
      tier: "tribe",
      quote: { text: "This unverified claim must never reach the page.", source_url: "https://x.test/b", verified: false },
    },
  ],
  extension: { domains: ["Sales"], priorities: [], value_inputs: {}, context: { stage_band: "seed" }, estimated: false },
};

const options: ValidatePageOptions = {
  value,
  research,
  assetHosts: ["cdn.example.com"],
  requiredAnchors: ["#business-case", "#book"],
  stopReason: "end_turn",
};

function goodHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap" rel="stylesheet" />
<title>Business case</title>
<style>:root{--brand:#c8102e;} body{font-family:var(--font-sans);}</style>
</head>
<body>
<header class="hero" role="banner">
  <img src="https://cdn.example.com/logo.png" alt="Acme" />
  <h1 id="hero-h">Built for Jordan at Acme</h1>
  <nav><a href="#business-case">See the business case</a> <a href="#book">Book a call</a></nav>
</header>
<main>
<section id="business-case" aria-labelledby="case-h">
  <h2 id="case-h">${value.sectionTitle}</h2>
  <p>${value.headline.label}: ${value.headline.value}</p>
  <p>${value.mechanism}</p>
  <p class="footnote">${value.footnote}</p>
</section>
<section id="book" aria-labelledby="book-h">
  <h2 id="book-h">Thirty minutes, your numbers</h2>
  <p>Reply to the outreach email and we walk it through together.</p>
</section>
</main>
<footer role="contentinfo"><p>Mirenta prepares this page for Acme. Confirm the figures.</p></footer>
</body>
</html>`;
}

test("accepts a compliant sample-grade page", () => {
  assert.doesNotThrow(() => validatePage(goodHtml(), options));
});

test("rejects a missing value figure as permanent", () => {
  const html = goodHtml().replace(value.headline.value, "~9 to 12 founder-hours reclaimed each week");
  assert.throws(
    () => validatePage(html, options),
    (e: unknown) => e instanceof PageValidationError && !e.transient && /value figure missing/.test((e as Error).message),
  );
});

test("rejects a <script src> tag", () => {
  const html = goodHtml().replace("</body>", `<script src="https://evil.test/x.js"></script></body>`);
  assert.throws(() => validatePage(html, options), /script/);
});

test("rejects an inline <script> too", () => {
  const html = goodHtml().replace("</body>", `<script>alert(1)</script></body>`);
  assert.throws(() => validatePage(html, options), /script/);
});

test("rejects an <iframe>", () => {
  const html = goodHtml().replace("</main>", `<iframe src="https://cdn.example.com/x"></iframe></main>`);
  assert.throws(() => validatePage(html, options), /iframe/);
});

test("rejects a <form>", () => {
  const html = goodHtml().replace("</main>", `<form action="/x"></form></main>`);
  assert.throws(() => validatePage(html, options), /form/);
});

test("rejects an inline event handler", () => {
  const html = goodHtml().replace('class="hero"', 'class="hero" onload="x()"');
  assert.throws(() => validatePage(html, options), /event handler/);
});

test("rejects a javascript: URI", () => {
  const html = goodHtml().replace('href="#book"', 'href="javascript:void(0)"');
  assert.throws(() => validatePage(html, options), PageValidationError);
});

test("rejects a non-allow-listed external asset host", () => {
  const html = goodHtml().replace("https://cdn.example.com/logo.png", "https://tracker.evil.test/p.gif");
  assert.throws(() => validatePage(html, options), /not allow-listed/);
});

test("accepts inline SVG xmlns namespace declarations (not asset fetches)", () => {
  // W3C namespace URIs are XML identifiers, never fetched, so the asset-host scan
  // must not reject www.w3.org.
  const html = goodHtml().replace(
    '<footer role="contentinfo">',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 16 16" role="img"><title>mark</title><rect width="16" height="16" /></svg>\n<footer role="contentinfo">',
  );
  assert.doesNotThrow(() => validatePage(html, options));
});

test("still rejects a real w3.org asset reference despite the xmlns exemption", () => {
  const html = goodHtml().replace(
    'src="https://cdn.example.com/logo.png"',
    'src="https://www.w3.org/Icons/logo.png"',
  );
  assert.throws(() => validatePage(html, options), /not allow-listed/);
});

test("rejects an unverified quote that leaks onto the page", () => {
  const html = goodHtml().replace(
    "<p>Reply to the outreach email and we walk it through together.</p>",
    "<p>This unverified claim must never reach the page.</p>",
  );
  assert.throws(() => validatePage(html, options), /unverified quote/);
});

test("rejects a missing #business-case section id", () => {
  const html = goodHtml().replace('id="business-case"', 'id="the-case"');
  assert.throws(() => validatePage(html, options), /#business-case/);
});

test("rejects a missing quick-link to #book", () => {
  const html = goodHtml().replace('<a href="#book">Book a call</a>', "<span>Book a call</span>");
  assert.throws(() => validatePage(html, options), /#book/);
});

test("rejects a missing hero banner", () => {
  const html = goodHtml().replace('role="banner"', 'class="x"');
  assert.throws(() => validatePage(html, options), /banner/);
});

test("classifies a max_tokens stop as transient", () => {
  assert.throws(
    () => validatePage(goodHtml(), { ...options, stopReason: "max_tokens" }),
    (e: unknown) => e instanceof PageValidationError && e.transient === true,
  );
});

test("classifies a truncated document (no closing html) as transient", () => {
  const html = goodHtml().replace("</html>", "");
  assert.throws(
    () => validatePage(html, options),
    (e: unknown) => e instanceof PageValidationError && e.transient === true,
  );
});

test("rejects a document that does not start with the doctype as permanent", () => {
  const html = `Here is your page:\n${goodHtml()}`;
  assert.throws(
    () => validatePage(html, options),
    (e: unknown) => e instanceof PageValidationError && !e.transient,
  );
});

test("rejects runaway body copy over the reading-time budget", () => {
  const filler = `<p>${"savings ".repeat(1300)}</p>`;
  const html = goodHtml().replace("</main>", `${filler}</main>`);
  assert.throws(() => validatePage(html, options), /runs long/);
});

test("injectRuntimeAssets welds in the CSP meta and the count-up script", () => {
  const out = injectRuntimeAssets(goodHtml());
  assert.match(out, /Content-Security-Policy/);
  assert.match(out, /<script>/);
  assert.match(out, /requestAnimationFrame/);
  assert.ok(out.indexOf("<script>") < out.indexOf("</body>"));
});
