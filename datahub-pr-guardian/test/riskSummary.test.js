const test = require("node:test");
const assert = require("node:assert/strict");
const { fallbackRisk, determineFallbackSeverity } = require("../src/analysis/riskSummary");

const structuralDiff = {
  modelName: "stg_orders",
  droppedColumns: ["customer_id"],
  renamedColumns: [],
  typeChanges: [],
  addedColumns: [],
  joinKeyChanges: { removed: [], added: [] },
};

const additiveDiff = {
  modelName: "stg_orders",
  droppedColumns: [],
  renamedColumns: [],
  typeChanges: [],
  addedColumns: ["new_col"],
  joinKeyChanges: { removed: [], added: [] },
};

const downstreamAssets = [
  { type: "DATASET", name: "fct_revenue", degree: 1, owners: ["finance@example.com"] },
];

test("returns high severity when structural break and downstream assets exist", () => {
  const result = fallbackRisk(structuralDiff, downstreamAssets);

  assert.equal(result.severity, "high");
});

test("returns medium severity when structural break but no downstream assets", () => {
  const result = fallbackRisk(structuralDiff, []);

  assert.equal(result.severity, "medium");
});

test("returns low severity when no structural break", () => {
  const result = fallbackRisk(additiveDiff, []);

  assert.equal(result.severity, "low");
});

test("determineFallbackSeverity returns high when both conditions are true", () => {
  assert.equal(determineFallbackSeverity(true, true), "high");
});

test("determineFallbackSeverity returns medium when only structural break is present", () => {
  assert.equal(determineFallbackSeverity(true, false), "medium");
});

test("determineFallbackSeverity returns low when no structural break", () => {
  assert.equal(determineFallbackSeverity(false, false), "low");
});
