const test = require("node:test");
const assert = require("node:assert/strict");
const { formatChangeDetails, renderSection } = require("../src/github/commentRenderer");
const { Severity } = require("../src/domain/severity");

const baseDiff = {
  modelName: "stg_orders",
  droppedColumns: [],
  renamedColumns: [],
  typeChanges: [],
  addedColumns: [],
  joinKeyChanges: { removed: [], added: [] },
};

test("renders a high-risk section header with red emoji", () => {
  const assessment = { severity: new Severity("high"), summary: "Risky change." };
  const section = renderSection(baseDiff, [], assessment);

  assert.ok(section.startsWith(`### ${new Severity("high").emoji} stg_orders — HIGH risk`));
});

test("renders dropped columns in change details", () => {
  const diff = { ...baseDiff, droppedColumns: ["customer_id", "order_total"] };
  const details = formatChangeDetails(diff);

  assert.equal(details[0], "Dropped columns: customer_id, order_total");
});

test("renders no structural change message when only columns are added", () => {
  const diff = { ...baseDiff, addedColumns: ["new_column"] };
  const details = formatChangeDetails(diff);

  assert.equal(details[0], "Added columns: new_column");
});

test("renders no structural change message when diff has no changes at all", () => {
  const details = formatChangeDetails(baseDiff);

  assert.equal(details[0], "No structural change detected.");
});
