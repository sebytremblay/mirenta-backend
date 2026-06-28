// The designer's pure parts: the tool schema, the system prompt, the prompt
// builder, and the output normalizer that runs validatePageSpec. These touch no
// provider and read no env, so the unit test exercises them directly. The runner
// in designer.ts pairs these with the Anthropic call.

import {
  SECTION_KINDS,
  LANDMARKS,
  validatePageSpec,
  PageSpecError,
  type PageSpec,
  type SectionSpec,
  type SectionKind,
  type Landmark,
} from "../domain/page-spec.ts";
import type { ResearchObject } from "../domain/research.ts";
import type { MetricRecipe } from "../domain/recipe.ts";
import type { Lead, ProductProfile } from "../domain/entities.ts";

export const EMIT_PAGE_SPEC_TOOL = "emit_page_spec";

export interface DesignerInput {
  lead: Pick<Lead, "first_name" | "last_name" | "role" | "company">;
  profile: Pick<ProductProfile, "company_name" | "product_name" | "value_prop">;
  research: ResearchObject;
  recipe: MetricRecipe;
  onStep?: (step: { phase: string; detail: string }) => void;
}

export const PAGE_SPEC_TOOL_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      description:
        "The ordered per-lead layout. Choose which kinds appear, how many, and in what order so no two leads share a skeleton. Include exactly one banner landmark (the hero), one value_render section, and one cta section.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique kebab-case id, becomes the HTML id" },
          kind: { type: "string", enum: [...SECTION_KINDS] },
          landmark: { type: "string", enum: [...LANDMARKS] },
          heading: { type: "string", description: "Concrete to this lead, not a generic label" },
          contentRefs: {
            type: "array",
            items: { type: "string" },
            description: "Keys into the research the section draws from (a priority domain, a voice name, \"value\")",
          },
        },
        required: ["id", "kind", "landmark", "heading", "contentRefs"],
      },
    },
    valueRenderSectionId: { type: "string", description: "The id of the value_render section" },
    ctaSectionId: { type: "string", description: "The id of the cta section" },
    quickLinkTargets: {
      type: "array",
      items: { type: "string" },
      description: "Hero quick-link targets, each a section id the hero links to",
    },
    artDirection: {
      type: "object",
      properties: {
        name: { type: "string", description: "Your name for this page's deliberate hand, not a menu pick" },
        signatureElement: {
          type: "string",
          description:
            "The ONE bold structural or visual move this page spends its boldness on, described concretely enough for the builder to execute it (for example a single oversized typographic statement, one asymmetric split layout, one distinctive value visual, or one editorial pull treatment). Name one move, not a list. Everything else stays quiet so the page reads as composed, not cluttered.",
        },
        typeTreatment: { type: "string", description: "Prose the builder follows for type and hierarchy" },
        motifs: {
          type: "array",
          items: { type: "string" },
          description: "A few quiet CSS-only supporting details that spend the brand tokens; never external assets, never a second bold move competing with the signature element",
        },
      },
      required: ["name", "signatureElement", "typeTreatment", "motifs"],
    },
  },
  required: ["sections", "valueRenderSectionId", "ctaSectionId", "quickLinkTargets", "artDirection"],
} as const;

export const DESIGNER_SYSTEM_PROMPT = `You are the Mirenta designer. You read the research on one founder and compose a bespoke page spec: the ordered sections of their one-pager, which section carries the value figure, which carries the CTA, and the art direction the builder follows. You write no HTML and no copy; you decide the structure and the hand.

# The structure

Choose the sections this founder's page needs from the kinds available: hero, priorities, challenges, pov, value_render, cta, footer, narrative. Order them for this founder. Two founders with different research must get visibly different structures, so let the research drive the shape rather than reaching for a default skeleton.

Hard requirements the spec must satisfy:
- Exactly one section carries the banner landmark; that is the hero.
- Exactly one value_render section, named in valueRenderSectionId, carries the quantifying figure.
- Exactly one cta section, named in ctaSectionId, carries the call to action.
- Every quick-link target resolves to a section id you declared.
- Section ids are unique and kebab-case. Headings are concrete to this founder, never generic labels.

# The art direction

Name the deliberate hand for this page (not a pick from a menu), then commit to ONE signature element: the single bold move this page spends its boldness on. A page earns a founder's attention through one strong idea executed with conviction, not through many devices stacked together. Choose the signature element you judge strongest for this founder, describe it concretely enough for the builder to execute it, and keep everything else quiet so it reads as composed rather than cluttered.

Pick one move, not a catalog. A signature element is a single oversized typographic statement, OR one asymmetric split that breaks the centered column, OR one distinctive value visual, OR one editorial pull treatment, OR one structural device that frames the whole page. Do not stack a saturated hero AND alternating bands AND a dark panel AND a chart and call the sum a design; that stack is the generic template the page must avoid. Let one move lead and let the rest recede.

Write a type treatment the builder follows and a few quiet CSS-only motifs that support the signature element without competing with it. Motifs spend the founder's brand tokens; they never pull external assets.

# Writing style

No contractions, active voice, present tense, strong verbs, no weak openers, no em dashes. Headings read as written for this founder.

Call emit_page_spec exactly once.`;

export function buildDesignerPrompt(input: DesignerInput): string {
  const { research, recipe } = input;
  const leadName = `${input.lead.first_name} ${input.lead.last_name}`;
  const priorities = research.extension.priorities
    .map((p) => `- ${p.domain}: ${p.pov} (why now: ${p.why_now})`)
    .join("\n");
  const voices = research.voices
    .map((v) => `- ${v.name} (${v.identity}, ${v.tier})`)
    .join("\n");
  return `Compose the page spec for a one-pager targeting ${leadName} at ${input.lead.company}.

Seller: ${input.profile.company_name} — ${input.profile.product_name}
Value proposition: ${input.profile.value_prop}

Account summary: ${research.account.summary}
Recent moves: ${research.account.recent_moves.join("; ") || "(none surfaced)"}
Domains: ${research.extension.domains.join(", ")}

Priorities:
${priorities || "(none surfaced)"}

Respected voices:
${voices || "(none surfaced)"}

The value figure renders under the heading "${recipe.sectionTitle}" with the label "${recipe.headlineLabel}". Place it in the value_render section.

Compose the sections, name the value-render and CTA sections, set the hero quick-links, and write the art direction. Call emit_page_spec exactly once.`;
}

export class PageSpecSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageSpecSchemaError";
  }
}

// Coerce the model output into a typed PageSpec, then run validatePageSpec. A
// malformed spec throws here rather than reaching the builder, since a missing
// required field can never be papered over downstream.
export function normalizePageSpec(raw: unknown): PageSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new PageSpecSchemaError("page spec is not an object");
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.sections)) {
    throw new PageSpecSchemaError("page spec sections must be an array");
  }
  const sections: SectionSpec[] = r.sections.map((s, idx) => {
    const sec = s as Record<string, unknown>;
    if (
      typeof sec.id !== "string" ||
      typeof sec.kind !== "string" ||
      typeof sec.landmark !== "string" ||
      typeof sec.heading !== "string" ||
      !Array.isArray(sec.contentRefs) ||
      !sec.contentRefs.every((c) => typeof c === "string")
    ) {
      throw new PageSpecSchemaError(`page spec sections[${idx}] malformed`);
    }
    return {
      id: sec.id,
      kind: sec.kind as SectionKind,
      landmark: sec.landmark as Landmark,
      heading: sec.heading,
      contentRefs: sec.contentRefs as string[],
    };
  });

  const art = r.artDirection as Record<string, unknown> | undefined;
  if (
    !art ||
    typeof art.name !== "string" ||
    typeof art.signatureElement !== "string" ||
    typeof art.typeTreatment !== "string" ||
    !Array.isArray(art.motifs) ||
    !art.motifs.every((m) => typeof m === "string")
  ) {
    throw new PageSpecSchemaError("page spec artDirection malformed");
  }

  if (
    typeof r.valueRenderSectionId !== "string" ||
    typeof r.ctaSectionId !== "string" ||
    !Array.isArray(r.quickLinkTargets) ||
    !r.quickLinkTargets.every((t) => typeof t === "string")
  ) {
    throw new PageSpecSchemaError("page spec references malformed");
  }

  const spec: PageSpec = {
    sections,
    valueRenderSectionId: r.valueRenderSectionId,
    ctaSectionId: r.ctaSectionId,
    quickLinkTargets: r.quickLinkTargets as string[],
    artDirection: {
      name: art.name,
      signatureElement: art.signatureElement,
      typeTreatment: art.typeTreatment,
      motifs: art.motifs as string[],
    },
  };

  // The well-formedness pass: unique ids, one banner, required kinds, resolving
  // references. A PageSpecError surfaces as a permanent designer-stage failure.
  try {
    validatePageSpec(spec);
  } catch (err) {
    if (err instanceof PageSpecError) {
      throw new PageSpecSchemaError(err.message);
    }
    throw err;
  }

  return spec;
}
