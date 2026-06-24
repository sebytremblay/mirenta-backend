// Unit tests for the post-generation page validator (D9, D37). The builder now
// emits the entire document, so this gate is the load-bearing trust boundary: it
// accepts a sample-grade page and rejects every contract or safety violation. The
// tests feed hand-built HTML strings (no live model) and assert the accept/reject
// boundary and the transient/permanent classification the worker depends on.

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
  sectionTitle: "Business Value",
  headline: { label: "Expected net annual savings", value: "$2.6M" },
  scenarios: [
    { name: "Conservative", primaryValue: "$1.6M", primaryLabel: "Net Annual Savings", secondary: "97% ROI" },
    { name: "Expected", primaryValue: "$2.6M", primaryLabel: "Net Annual Savings", secondary: "156% ROI" },
    { name: "Aggressive", primaryValue: "$3.7M", primaryLabel: "Net Annual Savings", secondary: "218% ROI" },
  ],
  metrics: [
    { label: "Expected ROI", value: "156%" },
    { label: "Payback period", value: "4.9 mo" },
    { label: "5-year net savings", value: "$10.1M" },
    { label: "NPV at 8 percent", value: "$7.8M" },
  ],
  projection: {
    label: "Cumulative net cash flow",
    unit: "USD",
    series: [
      { period: "Year 1", value: 374000, display: "$374K" },
      { period: "Year 2", value: 2192400, display: "$2.2M" },
      { period: "Year 3", value: 4840400, display: "$4.8M" },
      { period: "Year 4", value: 7488400, display: "$7.5M" },
      { period: "Year 5", value: 10136400, display: "$10.1M" },
    ],
  },
};

const research: ResearchObject = {
  vertical: "salesforce_employee_service",
  account: { summary: "An electronics firm.", recent_moves: [], self_description_language: "We build." },
  executives: [],
  quotes: [
    { text: "We invest in our people every day.", speaker: "CEO", source_url: "https://x.test/a", verified: true },
    { text: "This unverified claim must never reach the page.", speaker: "Rumor", source_url: "https://x.test/b", verified: false },
  ],
  extension: { domains: ["HR"], priorities: [], value_inputs: { total_employees: 20000 }, estimated: false },
};

const options: ValidatePageOptions = {
  value,
  research,
  assetHosts: ["cdn.example.com"],
  requiredAnchors: ["#business-case", "#book"],
  stopReason: "end_turn",
  leadName: "Jordan Avery",
};

// A compliant, sample-grade document: brand-themed, all figures present, required
// anchors resolved, no unsafe construct, only allow-listed external assets.
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
  <div class="tiles">
    <div class="tile"><span data-count="156" data-suffix="%">156%</span><span>Expected ROI</span></div>
    <div class="tile"><span data-count="4.9" data-suffix=" mo" data-decimals="1">4.9 mo</span><span>Payback period</span></div>
    <div class="tile"><span>$10.1M</span><span>5-year net savings</span></div>
    <div class="tile"><span>$7.8M</span><span>NPV at 8 percent</span></div>
  </div>
  <svg viewBox="0 0 760 380" role="img" aria-labelledby="chart-t">
    <title id="chart-t">Cumulative net cash flow</title>
    <desc>Year 1 $374K, Year 2 $2.2M, Year 3 $4.8M, Year 4 $7.5M, Year 5 $10.1M.</desc>
    <text>Year 1 $374K</text><text>Year 2 $2.2M</text><text>Year 3 $4.8M</text>
    <text>Year 4 $7.5M</text><text>Year 5 $10.1M</text>
  </svg>
  <div class="scenarios">
    <article>Conservative $1.6M Net Annual Savings 97% ROI</article>
    <article>Expected $2.6M Net Annual Savings 156% ROI</article>
    <article>Aggressive $3.7M Net Annual Savings 218% ROI</article>
  </div>
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
  const html = goodHtml().replace("$7.8M", "$9.9M");
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
  // Removing the #book quick-link also trips an anchor check, but the unsafe
  // construct check runs first; either way it rejects.
  assert.throws(() => validatePage(html, options), PageValidationError);
});

test("rejects a non-allow-listed external asset host", () => {
  const html = goodHtml().replace("https://cdn.example.com/logo.png", "https://tracker.evil.test/p.gif");
  assert.throws(() => validatePage(html, options), /not allow-listed/);
});

test("accepts inline SVG xmlns namespace declarations (not asset fetches)", () => {
  // The vertical-agnostic restyle renders inline SVG, which carries the W3C
  // namespace URIs. These are XML namespace identifiers, never fetched, so the
  // asset-host scan must not reject www.w3.org. A real asset reference still must.
  const html = goodHtml().replace(
    '<svg viewBox="0 0 760 380" role="img" aria-labelledby="chart-t">',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 760 380" role="img" aria-labelledby="chart-t">',
  );
  assert.doesNotThrow(() => validatePage(html, options));
});

test("still rejects a real w3.org asset reference despite the xmlns exemption", () => {
  // Stripping xmlns must not blanket-allow www.w3.org: a genuine src/href to it
  // is an un-allow-listed fetch and must reject.
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

test("rejects an em dash in model output as an AI tell", () => {
  const html = goodHtml().replace(
    "<p>Reply to the outreach email and we walk it through together.</p>",
    "<p>Reply to the outreach email — we walk it through together.</p>",
  );
  assert.throws(
    () => validatePage(html, options),
    (e: unknown) => e instanceof PageValidationError && /em or en dash/.test((e as Error).message),
  );
});

test("rejects an en dash too", () => {
  const html = goodHtml().replace("4.9 mo", "4.9 mo–ish");
  // The figure check still passes (4.9 mo is present as substring); the dash trips the tell gate.
  assert.throws(() => validatePage(html, options), /em or en dash/);
});

test("rejects an emoji card icon as an AI tell", () => {
  const html = goodHtml().replace(
    '<article>Conservative $1.6M Net Annual Savings 97% ROI</article>',
    '<article>\u{1F3C6} Conservative $1.6M Net Annual Savings 97% ROI</article>',
  );
  assert.throws(
    () => validatePage(html, options),
    (e: unknown) => e instanceof PageValidationError && /emoji/.test((e as Error).message),
  );
});

test("rejects a dingbat-range emoji with a variation selector", () => {
  const html = goodHtml().replace("Book a call", "Book a call \u{2705}\u{FE0F}");
  assert.throws(() => validatePage(html, options), /emoji/);
});

test("accepts plain ASCII hyphens and math symbols (not dashes)", () => {
  // The tell gate must not false-positive on a hyphen or a minus sign.
  const html = goodHtml().replace("5-year net savings", "5-year cost-saving net savings");
  assert.doesNotThrow(() => validatePage(html, options));
});

test("rejects a quote attributed to the lead (self-quoting)", () => {
  const html = goodHtml().replace(
    "<p>Reply to the outreach email and we walk it through together.</p>",
    '<blockquote>finding prospects takes longer than closing them<cite>Finn Mallery</cite></blockquote>',
  );
  assert.throws(
    () => validatePage(html, { ...options, leadName: "Finn Mallery" }),
    (e: unknown) => e instanceof PageValidationError && /attributed to the lead/.test((e as Error).message),
  );
});

test("allows a third-party cite even when a leadName is set", () => {
  const html = goodHtml().replace(
    "<p>Reply to the outreach email and we walk it through together.</p>",
    '<blockquote>The new bar is naming their workflow<cite>Garry Tan, Y Combinator</cite></blockquote>',
  );
  assert.doesNotThrow(() => validatePage(html, { ...options, leadName: "Finn Mallery" }));
});

test("allows a third-party cite that does not name the lead", () => {
  const html = goodHtml().replace(
    "<p>Reply to the outreach email and we walk it through together.</p>",
    '<blockquote>A quote<cite>Anyone At All</cite></blockquote>',
  );
  assert.doesNotThrow(() => validatePage(html, options));
});

test("rejects a hero intro that runs long before the headline", () => {
  const longIntro =
    '<p class="hero-mirror">Your best outreach earns replies because it names the exact workflow ' +
    'the prospect runs today, but building that depth for every target still takes an hour you do ' +
    'not have, and the math never closes across a real founder send volume of seventy seven a day.</p>' +
    '<p class="hero-moment">You proved the demand before the product even existed, on hundreds of ' +
    'calls across the first three months of the company.</p>';
  const html = goodHtml().replace(
    '<header class="hero" role="banner">',
    `<header class="hero" role="banner">${longIntro}`,
  );
  assert.throws(
    () => validatePage(html, options),
    (e: unknown) => e instanceof PageValidationError && /hero intro runs long/.test((e as Error).message),
  );
});

test("accepts a tight three-line hero intro under the cap", () => {
  const tightIntro =
    '<p>Finding qualified prospects takes longer than closing them.</p>' +
    '<p>You proved demand on 493 calls before the product shipped.</p>' +
    '<p>At Mirenta we write every page by hand, so we built the research engine.</p>';
  const html = goodHtml().replace(
    '<header class="hero" role="banner">',
    `<header class="hero" role="banner">${tightIntro}`,
  );
  assert.doesNotThrow(() => validatePage(html, options));
});

test("injectRuntimeAssets welds in the CSP meta and the count-up script", () => {
  const out = injectRuntimeAssets(goodHtml());
  assert.match(out, /Content-Security-Policy/);
  assert.match(out, /<script>/);
  assert.match(out, /requestAnimationFrame/);
  // The injected script sits before the closing body tag.
  assert.ok(out.indexOf("<script>") < out.indexOf("</body>"));
});
