import type { ConstraintResult, Status } from "../src/constraints.ts";

/** The model can explain a limit without claiming that the visible part is faulty. */
export function isReferenceConstraint(constraint: ConstraintResult): boolean {
  return constraint.kind === "model" || constraint.kind === "classification";
}

/** Aggregate names associated with each constraint; reference checks are shown here but never tinted. */
export const CONSTRAINT_PARTS: Readonly<Record<string, readonly string[]>> = {
  "nacelle-clearance": ["nacelles", "engines"],
  "span-code": ["wing.box"],
  "tail-strike": ["gear.main"],
  "bpr-range": ["engines"],
  mzfw: [], // Payload is not a defect of the cabin furnishings.
  "thrust-ceiling": ["engines"],
  "oei-climb": ["engines"],
  "oei-mtow": ["engines"],
  "takeoff-field": ["engines", "wing.highLift"],
  "approach-speed": ["wing.highLift"],
  "mission-distance": [], // A requested range shortfall has no uniquely faulty aggregate.
  "mission-no-passengers": [],
};

export type ConstraintTint = "warn" | "bad";

function tintSeverity(status: Status): number {
  if (status === "violation") return 2;
  if (status === "warning") return 1;
  return 0;
}

/** Highest actionable severity per aggregate, independent of constraint order. */
export function constraintTints(constraints: readonly ConstraintResult[]): Map<string, ConstraintTint> {
  const result = new Map<string, ConstraintTint>();
  for (const constraint of constraints) {
    if (isReferenceConstraint(constraint)) continue;
    const severity = tintSeverity(constraint.status);
    if (severity === 0) continue;
    const tint: ConstraintTint = severity === 2 ? "bad" : "warn";
    for (const part of CONSTRAINT_PARTS[constraint.id] ?? []) {
      const previous = result.get(part);
      if (!previous || (previous === "warn" && tint === "bad")) result.set(part, tint);
    }
  }
  return result;
}

export function constraintsForPart(constraints: readonly ConstraintResult[], partId: string): ConstraintResult[] {
  return constraints.filter(constraint => (CONSTRAINT_PARTS[constraint.id] ?? []).includes(partId));
}
