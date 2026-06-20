// Unit tests for research-object validation. The worker treats a schema-invalid
// result as a permanent failure, so the validator's accept/reject boundary is
// load-bearing and pinned here. The validator now takes the active vertical and
// delegates the value-input contract to its value model, so these tests pass the
// employee-service spec and assert against the generic extension shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResearch } from "../../src/domain/research.ts";
import { employeeServiceVertical } from "../../src/verticals/employee-service.ts";

const vertical = employeeServiceVertical;

function validPayload() {
  return {
    vertical: vertical.id,
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
      domains: [...vertical.domains],
      priorities: [
        { domain: "HR", pov: "Employee experience matters.", why_now: "Talent competition is rising." },
      ],
      value_inputs: { total_employees: 20000, it_staff: 150, hr_staff: 35 },
      estimated: true,
    },
  };
}

test("accepts a well-formed payload", () => {
  const r = validateResearch(validPayload(), vertical);
  assert.equal(r.vertical, vertical.id);
  assert.equal(r.executives.length, 1);
  assert.equal(r.extension.value_inputs.total_employees, 20000);
  assert.equal(r.extension.estimated, true);
});

test("coerces a non-boolean verified flag to false", () => {
  const p = validPayload();
  (p.quotes[0] as Record<string, unknown>).verified = "yes";
  const r = validateResearch(p, vertical);
  assert.equal(r.quotes[0]!.verified, false);
});

test("drops non-numeric value inputs", () => {
  const p = validPayload();
  (p.extension.value_inputs as Record<string, unknown>).it_staff = "lots";
  const r = validateResearch(p, vertical);
  assert.equal(r.extension.value_inputs.it_staff, undefined);
  assert.equal(r.extension.value_inputs.total_employees, 20000);
});

test("rejects a missing vertical", () => {
  const p = validPayload();
  delete (p as Record<string, unknown>).vertical;
  assert.throws(() => validateResearch(p, vertical), /vertical/);
});

test("rejects a missing account summary", () => {
  const p = validPayload();
  delete (p.account as Record<string, unknown>).summary;
  assert.throws(() => validateResearch(p, vertical), /account\.summary/);
});

test("rejects a malformed executive", () => {
  const p = validPayload();
  (p.executives[0] as Record<string, unknown>).title = 42;
  assert.throws(() => validateResearch(p, vertical), /executives\[0\]/);
});

test("rejects value inputs the vertical requires but the payload omits", () => {
  const p = validPayload();
  delete (p.extension.value_inputs as Record<string, unknown>).total_employees;
  assert.throws(() => validateResearch(p, vertical), /total_employees/);
});

test("rejects a non-object payload", () => {
  assert.throws(() => validateResearch(null, vertical), /not an object/);
  assert.throws(() => validateResearch("nope", vertical), /not an object/);
});

// Prospect brand tokens (D48). The brand is optional and never throws: a
// malformed field drops so the builder falls back rather than failing the job.

test("omits brand when absent", () => {
  const r = validateResearch(validPayload(), vertical);
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
  const r = validateResearch(p, vertical);
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
  const r = validateResearch(p, vertical);
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
  const r = validateResearch(p, vertical);
  assert.equal(r.brand?.logo_url, undefined);
  assert.equal(r.brand?.favicon_url, "https://acme.example/favicon.ico");
});

test("drops an all-invalid brand to undefined", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = { primary_color: "blue", logo_url: "ftp://x" };
  const r = validateResearch(p, vertical);
  assert.equal(r.brand, undefined);
});

test("a malformed brand does not fail the whole object", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = "not an object";
  const r = validateResearch(p, vertical);
  assert.equal(r.brand, undefined);
  assert.equal(r.executives.length, 1); // rest of the object still validates
});
