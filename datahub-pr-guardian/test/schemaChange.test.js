const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeSchemaChange, hasBreakingChange, extractColumns } = require("../src/analysis/schemaChange");

test("detects a dropped explicit select column", () => {
  const before = "select order_id, customer_id, order_total from raw_orders";
  const after = "select order_id, order_total from raw_orders";
  const change = analyzeSchemaChange(before, after);

  assert.deepEqual(change.droppedColumns, ["customer_id"]);
});

test("reports a breaking change when a column is dropped", () => {
  const before = "select order_id, customer_id, order_total from raw_orders";
  const after = "select order_id, order_total from raw_orders";
  const change = analyzeSchemaChange(before, after);

  assert.equal(hasBreakingChange(change), true);
});

test("recognizes a renamed alias without reporting a dropped column", () => {
  const before = "select customer_id as customer_key, order_total from raw_orders";
  const after = "select customer_id as customer_id, order_total from raw_orders";
  const change = analyzeSchemaChange(before, after);

  assert.deepEqual(change.renamedColumns, [{ from: "customer_key", to: "customer_id" }]);
});

test("reports no dropped columns when a column is only renamed", () => {
  const before = "select customer_id as customer_key, order_total from raw_orders";
  const after = "select customer_id as customer_id, order_total from raw_orders";
  const change = analyzeSchemaChange(before, after);

  assert.deepEqual(change.droppedColumns, []);
});

test("detects changed SQL casts", () => {
  const before = "select cast(order_total as decimal(12,2)) as revenue from raw_orders";
  const after = "select cast(order_total as bigint) as revenue from raw_orders";
  const change = analyzeSchemaChange(before, after);

  assert.deepEqual(change.typeChanges, [
    { column: "revenue", from: "decimal(12,2)", to: "bigint" },
  ]);
});

test("ignores comment-style pseudo-columns in the select list", () => {
  const sql = "select order_id, -- this is a comment\n order_total from raw_orders";
  const columns = extractColumns(sql);

  assert.ok(columns.every((col) => !col.name.startsWith("--")));
});
