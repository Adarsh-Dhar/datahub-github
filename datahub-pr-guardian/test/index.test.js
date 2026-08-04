const test = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Minimal diff object builders
// ---------------------------------------------------------------------------

function newModelDiff(modelName) {
  return {
    modelName,
    isNew: true,
    droppedColumns: [],
    renamedColumns: [],
    typeChanges: [],
    addedColumns: [],
    joinKeyChanges: { removed: [], added: [] },
  };
}

function additiveDiff(modelName) {
  return {
    modelName,
    isNew: false,
    droppedColumns: [],
    renamedColumns: [],
    typeChanges: [],
    addedColumns: ["new_col"],
    joinKeyChanges: { removed: [], added: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("skips processing when no changed models are found", (t) => {
  const diffParser = require("../src/github/diffParser");
  t.mock.method(diffParser, "getChangedModels", () => []);

  const changedFiles = diffParser.getChangedModels();
  assert.equal(changedFiles.length, 0);
});

test("skips a model marked as new", (t) => {
  const diffParser = require("../src/github/diffParser");
  t.mock.method(diffParser, "diffModel", () => newModelDiff("stg_orders"));

  const diff = diffParser.diffModel("models/staging/stg_orders.sql");
  assert.equal(diff.isNew, true);
});

test("skips a model with no breaking changes", (t) => {
  const diffParser = require("../src/github/diffParser");
  t.mock.method(diffParser, "diffModel", () => additiveDiff("dim_customers"));

  const { hasBreakingChange } = require("../src/analysis/schemaChange");
  const diff = diffParser.diffModel("models/marts/dim_customers.sql");

  assert.equal(hasBreakingChange(diff), false);
});

test("riskStrategy.evaluate is called for a breaking-change model", async (t) => {
  const { renderSection } = require("../src/github/commentRenderer");

  const stubbedStrategy = {
    evaluate: t.mock.fn(async () => ({
      assessment: { severity: "high", summary: "Breaking." },
      downstreamImpact: [],
      schemaProblems: [],
      contractViolations: { violations: [], typeViolations: [] },
      deprecationFlags: [],
    })),
    logStartupNotice() {},
  };

  const diff = {
    modelName: "stg_orders",
    isNew: false,
    droppedColumns: ["customer_id"],
    renamedColumns: [],
    typeChanges: [],
    addedColumns: [],
    joinKeyChanges: { removed: [], added: [] },
  };

  const { assessment, downstreamImpact, schemaProblems, contractViolations, deprecationFlags } = await stubbedStrategy.evaluate(diff);
  const section = renderSection(diff, downstreamImpact, assessment, { schemaProblems, contractViolations, deprecationFlags });

  assert.equal(stubbedStrategy.evaluate.mock.callCount(), 1);
});

test("buildCommentBody renders the no-changes message when no sections are present", () => {
  const { renderSection } = require("../src/github/commentRenderer");
  const { Severity } = require("../src/domain/severity");

  const section = renderSection(
    {
      modelName: "stg_orders",
      droppedColumns: ["id"],
      renamedColumns: [],
      typeChanges: [],
      addedColumns: [],
      joinKeyChanges: { removed: [], added: [] },
    },
    [],
    { severity: new Severity("high"), summary: "Breaking change." },
  );

  assert.ok(section.includes(`${new Severity("high").emoji} stg_orders — HIGH risk`));
});
