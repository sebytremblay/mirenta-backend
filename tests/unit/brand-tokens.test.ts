import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveTokens,
  readableOn,
  tint,
  lighten,
  darken,
  mix,
  sanitizeFontFamily,
  renderTokenBlock,
  resolveLogoUrl,
  resolveFaviconHref,
  resolveGoogleFontHref,
  resolvePairing,
  resolveFontPlan,
} from "../../src/agents/brand-tokens.ts";
import type { ProductProfile } from "../../src/domain/entities.ts";
import type { ProspectBrand } from "../../src/domain/research.ts";

function profile(brand?: ProductProfile["brand"]): ProductProfile {
  return {
    org_id: "org_1",
    company_name: "Seller Co",
    product_name: "Widget",
    value_prop: "Saves time",
    positioning: null,
    proof_points: null,
    cta_text: null,
    brand: brand ?? null,
    vertical: "salesforce_employee_service",
    economics: null,
    created_at: "",
    updated_at: "",
  };
}

const VERTICAL_ACCENT = "#0176d3";

test("prospect brand color wins over seller and the vertical accent", () => {
  const brand: ProspectBrand = { primary_color: "#aa0000" };
  const t = deriveTokens(profile({ primary_color: "#00aa00" }), brand, VERTICAL_ACCENT);
  assert.equal(t.brand, "#aa0000");
});

test("seller brand color applies when the prospect has none", () => {
  const t = deriveTokens(profile({ primary_color: "#00aa00" }), {}, VERTICAL_ACCENT);
  assert.equal(t.brand, "#00aa00");
});

test("the vertical accent applies when neither prospect nor seller supplies a color", () => {
  assert.equal(deriveTokens(profile(), undefined, VERTICAL_ACCENT).brand, VERTICAL_ACCENT);
});

test("a malformed seller color falls through to the vertical accent", () => {
  const t = deriveTokens(profile({ primary_color: "green" }), undefined, VERTICAL_ACCENT);
  assert.equal(t.brand, VERTICAL_ACCENT);
});

test("a neutral house default backstops a missing vertical accent", () => {
  const t = deriveTokens(profile(), undefined);
  assert.match(t.brand, /^#[0-9A-Fa-f]{6}$/);
});

test("tokens fall back independently on a partial prospect brand", () => {
  const t = deriveTokens(profile(), { background_color: "#101010" }, VERTICAL_ACCENT);
  assert.equal(t.bg, "#101010");
  assert.equal(t.brand, VERTICAL_ACCENT);
  assert.equal(t.accent, VERTICAL_ACCENT);
});

test("readableOn returns dark text on a light brand and white on a dark brand", () => {
  assert.equal(readableOn("#ffffff"), "#111111");
  assert.equal(readableOn("#fde047"), "#111111");
  assert.equal(readableOn("#0b1f3a"), "#ffffff");
  assert.equal(readableOn("#000000"), "#ffffff");
});

test("brand foreground stays readable over a light prospect color", () => {
  const t = deriveTokens(profile(), { primary_color: "#fde047" });
  assert.equal(t.brandForeground, "#111111");
});

test("tint produces an rgba derived from the hex", () => {
  assert.equal(tint("#0176d3", 0.06), "rgba(1, 118, 211, 0.06)");
});

test("sanitizeFontFamily strips a CSS injection and keeps a fallback", () => {
  const malicious = `Inter; } body { display:none } @import url(x);`;
  const out = sanitizeFontFamily(malicious);
  assert.ok(!out.includes("{"));
  assert.ok(!out.includes("}"));
  assert.ok(!out.includes(";"));
  assert.ok(!out.includes("@"));
  assert.ok(/sans-serif/.test(out));
});

test("sanitizeFontFamily keeps a clean stack as-is", () => {
  assert.equal(sanitizeFontFamily('"Helvetica Neue", sans-serif'), '"Helvetica Neue", sans-serif');
});

test("sanitizeFontFamily falls back when undefined or emptied", () => {
  assert.ok(/sans-serif/.test(sanitizeFontFamily(undefined)));
  assert.ok(/sans-serif/.test(sanitizeFontFamily("{}();")));
});

test("renderTokenBlock emits the resolved values as custom properties", () => {
  const block = renderTokenBlock(deriveTokens(profile(), { primary_color: "#aa0000" }));
  assert.ok(block.includes("--brand: #aa0000;"));
  assert.ok(block.includes("--font-sans:"));
});

test("resolveLogoUrl prefers the prospect logo, then the seller logo", () => {
  assert.equal(
    resolveLogoUrl(profile({ logo_url: "https://seller.example/l.png" }), {
      logo_url: "https://acme.example/l.svg",
    }),
    "https://acme.example/l.svg",
  );
  assert.equal(
    resolveLogoUrl(profile({ logo_url: "https://seller.example/l.png" }), undefined),
    "https://seller.example/l.png",
  );
  assert.equal(resolveLogoUrl(profile(), undefined), undefined);
});

test("resolveFaviconHref prefers the captured favicon, then the site default", () => {
  assert.equal(
    resolveFaviconHref("https://acme.example", { favicon_url: "https://cdn.example/f.ico" }),
    "https://cdn.example/f.ico",
  );
  assert.equal(
    resolveFaviconHref("https://acme.example/", undefined),
    "https://acme.example/favicon.ico",
  );
  assert.equal(resolveFaviconHref(null, undefined), undefined);
});

test("resolveGoogleFontHref returns a Google Fonts href for a known font", () => {
  const href = resolveGoogleFontHref("Oswald");
  assert.ok(typeof href === "string");
  assert.ok(href!.includes("fonts.googleapis.com/css2?family=Oswald"));
});

test("resolveGoogleFontHref is case- and quote-insensitive", () => {
  const canonical = resolveGoogleFontHref("Oswald");
  const fromList  = resolveGoogleFontHref('"oswald", sans-serif');
  assert.equal(fromList, canonical);
});

test("resolveGoogleFontHref returns undefined for an unrecognized font", () => {
  assert.equal(resolveGoogleFontHref("No Such Font 9000"), undefined);
});

test("renderTokenBlock emits a --font-display custom property", () => {
  const block = renderTokenBlock(deriveTokens(profile(), { primary_color: "#aa0000" }));
  assert.ok(block.includes("--font-display:"));
});

test("deriveTokens sets fontDisplay to a quoted proper-name stack for an allow-listed font", () => {
  const t = deriveTokens(profile(), { font_family: "Oswald" });
  assert.ok(t.fontDisplay.startsWith('"Oswald"'));
});

test("deriveTokens sets fontDisplay to the body font stack for an unknown font", () => {
  const t = deriveTokens(profile(), { font_family: "No Such Font 9000" });
  assert.equal(t.fontDisplay, t.font);
});

test("lighten, darken, and mix are deterministic and total on malformed input", () => {
  assert.equal(lighten("#000000", 0.5), "#808080");
  assert.equal(darken("#ffffff", 0.5), "#808080");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(lighten("not-a-color", 0.5), "not-a-color");
  assert.equal(mix("#000000", "bad", 0.5), "#000000");
});

test("renderTokenBlock emits the widened expressive tokens", () => {
  const block = renderTokenBlock(deriveTokens(profile(), { primary_color: "#aa0000" }));
  for (const name of [
    "--brand-strong",
    "--brand-soft",
    "--surface-elevated",
    "--surface-dark",
    "--surface-dark-fg",
    "--brand-tint-strong",
    "--shadow",
    "--shadow-lg",
    "--ring",
  ]) {
    assert.ok(block.includes(`${name}:`), `missing ${name}`);
  }
});

test("the dark-panel foreground stays readable on the derived dark surface", () => {
  const t = deriveTokens(profile(), { primary_color: "#aa0000" });
  assert.equal(t.surfaceDarkForeground, readableOn(t.surfaceDark));
  assert.equal(t.surfaceDarkForeground, "#ffffff");
});

test("a prospect primary without an accent derives a distinct second color", () => {
  const t = deriveTokens(profile(), { primary_color: "#aa0000" });
  assert.notEqual(t.accent, t.brand);
  assert.match(t.accent, /^#[0-9a-f]{6}$/i);
});

test("a fallback color keeps accent equal to brand (no fabricated second color)", () => {
  // Resolution-order behavior the existing tests pin: when only a background is
  // set, brand and accent both come from the vertical accent.
  const t = deriveTokens(profile(), { background_color: "#101010" }, VERTICAL_ACCENT);
  assert.equal(t.accent, VERTICAL_ACCENT);
  assert.equal(t.brand, VERTICAL_ACCENT);
});

test("resolvePairing is deterministic for the same seed", () => {
  assert.deepEqual(resolvePairing("Replit"), resolvePairing("Replit"));
});

test("resolveFontPlan keeps an allow-listed prospect font driving the page", () => {
  const plan = resolveFontPlan({ font_family: "Oswald" }, "Replit");
  assert.ok(plan.href!.includes("fonts.googleapis.com/css2?family=Oswald"));
  assert.ok(plan.fontDisplay.startsWith('"Oswald"'));
});

test("resolveFontPlan falls back to a curated pairing href on an unknown font", () => {
  const plan = resolveFontPlan({ font_family: "No Such Font 9000" }, "Replit");
  assert.ok(typeof plan.href === "string");
  assert.ok(plan.href!.startsWith("https://fonts.googleapis.com/css2?family="));
  // A pairing carries two families in one css2 href.
  assert.equal((plan.href!.match(/family=/g) ?? []).length, 2);
  assert.ok(plan.fontDisplay.includes('"'));
  assert.ok(plan.fontSans.includes('"'));
});

test("deriveTokens with a seed routes fonts through the pairing fallback", () => {
  const t = deriveTokens(profile(), { font_family: "No Such Font 9000" }, VERTICAL_ACCENT, "Replit");
  // The seeded path never collapses to a bare system stack: the display face is
  // a quoted proper name from the pairing.
  assert.ok(t.fontDisplay.includes('"'));
});

test("a widened font key resolves to a Google Fonts href", () => {
  const href = resolveGoogleFontHref("Space Grotesk");
  assert.ok(href!.includes("fonts.googleapis.com/css2?family=Space+Grotesk"));
});
