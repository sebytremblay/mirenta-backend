// Unit tests for research-object validation. The worker treats a schema-invalid
// result as a permanent failure, so the validator's accept/reject boundary is
// load-bearing and pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResearch, MVP_VERTICAL, MVP_DOMAINS } from "../../src/domain/research.ts";

function validPayload() {
  return {
    vertical: MVP_VERTICAL,
    account: {
      summary: "An electronics manufacturing services firm.",
      recent_moves: ["Acquired a software firm."],
      self_description_language: "We help create the products that build a better world.",
    },
    executives: [
      { name: "Jordan Avery", title: "VP of IT", owns: "IT operations", profile: "Drives IT modernization." },
    ],
    quotes: [
      { text: "We invest in our people.", speaker: "CEO", source_url: "https://example.com/a", verified: true },
    ],
    extension: {
      domains: [...MVP_DOMAINS],
      priorities: [
        { domain: "HR", pov: "Employee experience matters.", why_now: "Talent competition is rising." },
      ],
      roi_inputs: { total_employees: 20000, it_staff: 150, hr_staff: 35, estimated: true },
    },
  };
}

test("accepts a well-formed payload", () => {
  const r = validateResearch(validPayload());
  assert.equal(r.vertical, MVP_VERTICAL);
  assert.equal(r.executives.length, 1);
  assert.equal(r.extension.roi_inputs.total_employees, 20000);
});

test("coerces a non-boolean verified flag to false", () => {
  const p = validPayload();
  (p.quotes[0] as Record<string, unknown>).verified = "yes";
  const r = validateResearch(p);
  assert.equal(r.quotes[0]!.verified, false);
});

test("defaults missing staff counts to zero", () => {
  const p = validPayload();
  delete (p.extension.roi_inputs as Record<string, unknown>).it_staff;
  const r = validateResearch(p);
  assert.equal(r.extension.roi_inputs.it_staff, 0);
});

test("rejects a missing vertical", () => {
  const p = validPayload();
  delete (p as Record<string, unknown>).vertical;
  assert.throws(() => validateResearch(p), /vertical/);
});

test("rejects a missing account summary", () => {
  const p = validPayload();
  delete (p.account as Record<string, unknown>).summary;
  assert.throws(() => validateResearch(p), /account\.summary/);
});

test("rejects a malformed executive", () => {
  const p = validPayload();
  (p.executives[0] as Record<string, unknown>).title = 42;
  assert.throws(() => validateResearch(p), /executives\[0\]/);
});

test("rejects missing total_employees", () => {
  const p = validPayload();
  delete (p.extension.roi_inputs as Record<string, unknown>).total_employees;
  assert.throws(() => validateResearch(p), /total_employees/);
});

test("rejects a non-object payload", () => {
  assert.throws(() => validateResearch(null), /not an object/);
  assert.throws(() => validateResearch("nope"), /not an object/);
});

// Prospect brand tokens (D48). The brand is optional and never throws: a
// malformed field drops so the builder falls back rather than failing the job.

test("omits brand when absent", () => {
  const r = validateResearch(validPayload());
  assert.equal(r.brand, undefined);
});

test("passes through a well-formed brand", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = {
    primary_color: "#1A2B3C",
    accent_color: "#ffffff",
    font_family: "Inter",
    logo_url: "https://acme.example/logo.svg",
    favicon_url: "https://acme.example/favicon.ico",
  };
  const r = validateResearch(p);
  assert.equal(r.brand?.primary_color, "#1A2B3C");
  assert.equal(r.brand?.font_family, "Inter");
  assert.equal(r.brand?.logo_url, "https://acme.example/logo.svg");
});

test("drops invalid hex colors but keeps valid ones", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = {
    primary_color: "#123456",
    accent_color: "red", // not hex
    background_color: "#fff", // three-digit, rejected
  };
  const r = validateResearch(p);
  assert.equal(r.brand?.primary_color, "#123456");
  assert.equal(r.brand?.accent_color, undefined);
  assert.equal(r.brand?.background_color, undefined);
});

test("drops non-https asset URLs", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = {
    logo_url: "http://acme.example/logo.png", // not https
    favicon_url: "https://acme.example/favicon.ico",
  };
  const r = validateResearch(p);
  assert.equal(r.brand?.logo_url, undefined);
  assert.equal(r.brand?.favicon_url, "https://acme.example/favicon.ico");
});

test("drops an all-invalid brand to undefined", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = { primary_color: "blue", logo_url: "ftp://x" };
  const r = validateResearch(p);
  assert.equal(r.brand, undefined);
});

test("a malformed brand does not fail the whole object", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = "not an object";
  const r = validateResearch(p);
  assert.equal(r.brand, undefined);
  assert.equal(r.executives.length, 1); // rest of the object still validates
});
