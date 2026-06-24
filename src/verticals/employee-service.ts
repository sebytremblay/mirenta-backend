import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { ValueModelContractError } from "./contract.ts";

// This vertical owns its economics shape. An autonomous support layer returns a
// share of annual operating spend, expressed as a single benchmarked rate in
// basis points; compute reads that rate and renders one honest figure.
interface EmployeeServiceEconomics {
  savings_basis_points: number;
}

function isEmployeeServiceEconomics(raw: unknown): raw is EmployeeServiceEconomics {
  if (typeof raw !== "object" || raw === null) return false;
  const bps = (raw as Record<string, unknown>).savings_basis_points;
  return typeof bps === "number" && Number.isFinite(bps) && bps > 0;
}

function validateEconomics(raw: unknown): VerticalEconomics {
  if (!isEmployeeServiceEconomics(raw)) {
    throw new ValueModelContractError(
      "employee service economics requires savings_basis_points as a positive finite number",
    );
  }
  return raw as unknown as VerticalEconomics;
}

function defaultEconomics(): VerticalEconomics {
  return { savings_basis_points: 35 };
}

function validateInputs(
  raw: Record<string, number>,
  estimated: boolean,
  context: Record<string, string> = {},
): ValidatedInputs {
  if (typeof raw.total_employees !== "number") {
    throw new Error("research.extension.value_inputs.total_employees missing");
  }
  return {
    values: { total_employees: raw.total_employees },
    context: { ...context },
    estimated,
  };
}

function createCompute(economics: VerticalEconomics) {
  return (inputs: ValidatedInputs): ValueResult => {
    const bps = economics.savings_basis_points as number;
    const employees = Math.max(0, Math.floor(inputs.values.total_employees ?? 0));
    return {
      sectionTitle: "What an autonomous support layer returns",
      headline: {
        label: "Annual operating spend returned",
        value: `roughly ${bps} basis points of annual operating spend`,
      },
      mechanism: `An autonomous support layer resolves HR and ITSM requests for your ${employees} people without a human in the loop, and the benchmarked rate of ${bps} basis points names the share of annual operating spend that work returns.`,
      footnote: inputs.estimated
        ? "We estimated your headcount from public signals, so treat this rate as a directional read, not a quote."
        : undefined,
    };
  };
}

const inputGuidance = `Gather one numeric value_input:
- total_employees: total global headcount (required).
Use the actual count when you find it in job postings, org charts, or releases, and set estimated: false. When you infer it from public signals, estimate the count and set estimated: true. Gather no context keys.`;

function createValueModel(profile: ProductProfile): BoundValueModel {
  const economics = profile.economics ? validateEconomics(profile.economics) : defaultEconomics();

  return {
    inputGuidance,
    validateInputs,
    compute: createCompute(economics),
    economics,
  };
}

export const employeeServiceVertical: VerticalSpec = {
  id: "salesforce_employee_service",
  label: "Salesforce Employee Service (HR and ITSM)",
  domains: ["HR", "ITSM"],
  domainGuidance: `Surface the HR and ITSM priorities a founder owns directly: the onboarding, access, and support work that lands on the founder until the company hires the role away. Frame each domain priority as a point of view (POV): a stance on what the founder recognizes as their own burden right now.`,
  voiceTargeting: `Prioritize the founder's respected voices across the self, backer, and tribe ladder:
- self: the founder's own words on building the early team and carrying its support load
- backer: an investor or operator who funded or advised the founder
- tribe: a widely revered founder or builder whose words the founder follows`,
  defaultAccentColor: "#0176d3",
  inputGuidance,
  validateInputs,
  createValueModel,
  defaultEconomics,
  validateEconomics,
};
