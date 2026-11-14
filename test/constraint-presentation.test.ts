import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConstraintResult } from "../src/constraints.ts";
import { constraintTints, constraintsForPart, isReferenceConstraint } from "../web/constraintPresentation.ts";

function cause(id: string, status: ConstraintResult["status"], kind?: ConstraintResult["kind"]): ConstraintResult {
  return { id, label: id, status, kind, value: "value", limit: "limit", message: "message" };
}

test("aggregate tint takes the highest actionable severity regardless of constraint order", () => {
  const warn = cause("nacelle-clearance", "warning", "geometry");
  const bad = cause("oei-climb", "violation", "operational");
  const expected = new Map([["engines", "bad"], ["nacelles", "warn"]]);
  assert.deepEqual(constraintTints([warn, bad]), expected);
  assert.deepEqual(constraintTints([bad, warn]), expected);
});

test("model and classification causes remain visible but do not tint parts or override operational warnings", () => {
  const model = cause("bpr-range", "violation", "model");
  const classification = cause("span-code", "warning", "classification");
  const operational = cause("takeoff-field", "warning", "operational");
  assert.equal(isReferenceConstraint(model), true);
  assert.equal(isReferenceConstraint(classification), true);
  assert.deepEqual(constraintTints([model, classification]), new Map());
  assert.deepEqual(constraintTints([model, classification, operational]), new Map([
    ["engines", "warn"], ["wing.highLift", "warn"],
  ]));
  assert.deepEqual(constraintsForPart([model, operational, classification], "engines"), [model, operational]);
  assert.deepEqual(constraintsForPart([classification], "wing.box"), [classification]);
});

test("informational causes do not create warning tints", () => {
  assert.deepEqual(constraintTints([
    cause("nacelle-clearance", "info", "operational"),
    cause("span-code", "ok", "classification"),
  ]), new Map());
});
