// The bespoke page spec: how the one-pager's structure and styling adapt per
// lead instead of riding one fixed 7-section skeleton.
//
// The designer (Opus) reads the research and composes a PageSpec: an ordered list
// of typed sections, which section carries the value figure, which carries the
// CTA, and an art direction the builder follows. The builder (Haiku) renders HTML
// that satisfies the spec. page-validation.ts then checks the rendered HTML
// against the spec rather than against a hardcoded section list, while keeping
// every safety scan it ran before.

// The section kinds the designer can place. A closed set so validation and the
// builder share one vocabulary, but the designer chooses which kinds appear, in
// what order, and how many, so no two leads get the same skeleton.
export type SectionKind =
  | "hero"
  | "priorities"
  | "challenges"
  | "pov"
  | "value_render"
  | "cta"
  | "footer"
  | "narrative";

export const SECTION_KINDS: readonly SectionKind[] = [
  "hero",
  "priorities",
  "challenges",
  "pov",
  "value_render",
  "cta",
  "footer",
  "narrative",
];

// The ARIA landmark a section maps to. Exactly one banner and one contentinfo
// must appear across the page; the rest are regions tied to their heading.
export type Landmark = "banner" | "main" | "contentinfo" | "region";

export const LANDMARKS: readonly Landmark[] = ["banner", "main", "contentinfo", "region"];

export interface SectionSpec {
  id: string; // unique, kebab-case, becomes the HTML id and aria-labelledby target
  kind: SectionKind;
  landmark: Landmark;
  heading: string; // concrete to this lead, not a generic label
  contentRefs: string[]; // keys into the research/value the section draws from
}

// The per-lead art direction. name is designer-chosen, NOT a closed menu, so the
// page reads as one deliberate hand. signatureElement names the ONE bold move the
// page spends its boldness on; everything else stays quiet, which is what keeps
// the page from reading as cluttered template boilerplate. typeTreatment and
// motifs are prose the builder follows; they decorate within the brand tokens and
// never alter the section set or add external assets.
export interface ArtDirection {
  name: string;
  signatureElement: string;
  typeTreatment: string;
  motifs: string[];
}

export interface PageSpec {
  sections: SectionSpec[]; // ordered, the per-lead layout
  valueRenderSectionId: string; // which section carries the figure (required)
  ctaSectionId: string; // which section carries the CTA (required)
  quickLinkTargets: string[]; // hero quick-links; each must resolve to a section id
  artDirection: ArtDirection;
}

export class PageSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageSpecError";
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Validate the spec's well-formedness before the builder runs. A malformed spec
// throws rather than reaching the builder, since a missing required field can
// never be papered over downstream.
export function validatePageSpec(spec: PageSpec): void {
  if (!spec || !Array.isArray(spec.sections) || spec.sections.length === 0) {
    throw new PageSpecError("page spec must declare at least one section");
  }

  const ids = new Set<string>();
  let banners = 0;
  for (const section of spec.sections) {
    if (typeof section.id !== "string" || !KEBAB.test(section.id)) {
      throw new PageSpecError(`section id must be kebab-case: ${String(section.id)}`);
    }
    if (ids.has(section.id)) {
      throw new PageSpecError(`duplicate section id: ${section.id}`);
    }
    ids.add(section.id);
    if (!SECTION_KINDS.includes(section.kind)) {
      throw new PageSpecError(`unknown section kind: ${String(section.kind)}`);
    }
    if (!LANDMARKS.includes(section.landmark)) {
      throw new PageSpecError(`unknown landmark: ${String(section.landmark)}`);
    }
    if (typeof section.heading !== "string" || section.heading.trim() === "") {
      throw new PageSpecError(`section ${section.id} requires a non-empty heading`);
    }
    if (section.landmark === "banner") banners += 1;
  }

  if (banners !== 1) {
    throw new PageSpecError(`page spec must declare exactly one banner landmark, found ${banners}`);
  }

  const has = (kind: SectionKind): boolean => spec.sections.some((s) => s.kind === kind);
  for (const required of ["hero", "value_render", "cta"] as const) {
    if (!has(required)) {
      throw new PageSpecError(`page spec must include a ${required} section`);
    }
  }

  if (!ids.has(spec.valueRenderSectionId)) {
    throw new PageSpecError(`valueRenderSectionId does not resolve: ${spec.valueRenderSectionId}`);
  }
  if (!ids.has(spec.ctaSectionId)) {
    throw new PageSpecError(`ctaSectionId does not resolve: ${spec.ctaSectionId}`);
  }
  const valueSection = spec.sections.find((s) => s.id === spec.valueRenderSectionId);
  if (valueSection?.kind !== "value_render") {
    throw new PageSpecError("valueRenderSectionId must point at a value_render section");
  }
  const ctaSection = spec.sections.find((s) => s.id === spec.ctaSectionId);
  if (ctaSection?.kind !== "cta") {
    throw new PageSpecError("ctaSectionId must point at a cta section");
  }

  if (!Array.isArray(spec.quickLinkTargets) || spec.quickLinkTargets.length === 0) {
    throw new PageSpecError("page spec must declare at least one quick-link target");
  }
  for (const target of spec.quickLinkTargets) {
    if (!ids.has(target)) {
      throw new PageSpecError(`quick-link target does not resolve: ${target}`);
    }
  }

  if (
    !spec.artDirection ||
    typeof spec.artDirection.name !== "string" ||
    spec.artDirection.name.trim() === "" ||
    typeof spec.artDirection.signatureElement !== "string" ||
    spec.artDirection.signatureElement.trim() === "" ||
    typeof spec.artDirection.typeTreatment !== "string" ||
    spec.artDirection.typeTreatment.trim() === ""
  ) {
    throw new PageSpecError("art direction requires a name, a signature element, and a type treatment");
  }
}
