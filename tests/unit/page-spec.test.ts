import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePageSpec, PageSpecError, type PageSpec } from "../../src/domain/page-spec.ts";

function validSpec(): PageSpec {
  return {
    sections: [
      { id: "hero", kind: "hero", landmark: "banner", heading: "For Finn at Origami", contentRefs: ["account.summary"] },
      { id: "priorities", kind: "priorities", landmark: "region", heading: "Where the week goes", contentRefs: ["priorities"] },
      { id: "the-case", kind: "value_render", landmark: "region", heading: "What this frees up", contentRefs: ["value"] },
      { id: "lets-talk", kind: "cta", landmark: "region", heading: "Trade notes", contentRefs: [] },
      { id: "foot", kind: "footer", landmark: "contentinfo", heading: "Disclosure", contentRefs: [] },
    ],
    valueRenderSectionId: "the-case",
    ctaSectionId: "lets-talk",
    quickLinkTargets: ["the-case", "lets-talk"],
    artDirection: { name: "Editorial restraint", typeTreatment: "Serif display, hairline rules", motifs: ["numbered index"] },
  };
}

test("validatePageSpec accepts a well-formed bespoke spec", () => {
  assert.doesNotThrow(() => validatePageSpec(validSpec()));
});

test("validatePageSpec rejects duplicate section ids", () => {
  const spec = validSpec();
  spec.sections[1]!.id = "hero";
  assert.throws(() => validatePageSpec(spec), /duplicate section id/);
});

test("validatePageSpec rejects a non-kebab section id", () => {
  const spec = validSpec();
  spec.sections[1]!.id = "Priorities Section";
  assert.throws(() => validatePageSpec(spec), /kebab-case/);
});

test("validatePageSpec requires exactly one banner landmark", () => {
  const spec = validSpec();
  spec.sections[1]!.landmark = "banner";
  assert.throws(() => validatePageSpec(spec), /exactly one banner/);
});

test("validatePageSpec requires a hero, value_render, and cta", () => {
  const spec = validSpec();
  spec.sections = spec.sections.filter((s) => s.kind !== "cta");
  spec.ctaSectionId = "the-case"; // dangling, but the missing-kind check fires first
  assert.throws(() => validatePageSpec(spec), /must include a cta section/);
});

test("validatePageSpec rejects a value render id that does not resolve", () => {
  const spec = validSpec();
  spec.valueRenderSectionId = "ghost";
  assert.throws(() => validatePageSpec(spec), /valueRenderSectionId does not resolve/);
});

test("validatePageSpec rejects a value render id pointing at a non-value section", () => {
  const spec = validSpec();
  spec.valueRenderSectionId = "priorities";
  assert.throws(() => validatePageSpec(spec), /must point at a value_render section/);
});

test("validatePageSpec rejects a quick-link target that does not resolve", () => {
  const spec = validSpec();
  spec.quickLinkTargets = ["the-case", "ghost"];
  assert.throws(() => validatePageSpec(spec), /quick-link target does not resolve/);
});

test("validatePageSpec requires an art direction name and type treatment", () => {
  const spec = validSpec();
  spec.artDirection.typeTreatment = "";
  assert.throws(() => validatePageSpec(spec), PageSpecError);
});

test("validatePageSpec rejects an empty section list", () => {
  const spec = validSpec();
  spec.sections = [];
  assert.throws(() => validatePageSpec(spec), /at least one section/);
});
