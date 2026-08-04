const test = require("node:test");
const assert = require("node:assert/strict");
const { extractColumns, extractJoinKeys } = require("../src/analysis/sqlParser");

test("ignores comment-style pseudo-columns in the select list", () => {
  const sql = "select order_id, -- this is a comment\n order_total from raw_orders";
  const columns = extractColumns(sql);

  assert.ok(columns.every((col) => !col.name.startsWith("--")));
});

test("extracts columns from a simple select statement", () => {
  const sql = "select order_id, customer_id, order_total from raw_orders";
  const columns = extractColumns(sql);

  assert.deepEqual(
    columns.map((c) => c.name),
    ["order_id", "customer_id", "order_total"],
  );
});

test("extracts a column alias defined with AS", () => {
  const sql = "select order_total as revenue from raw_orders";
  const columns = extractColumns(sql);

  assert.equal(columns[0].name, "revenue");
});

test("extracts the type from a CAST expression", () => {
  const sql = "select cast(order_total as decimal(12,2)) as revenue from raw_orders";
  const columns = extractColumns(sql);

  assert.equal(columns[0].type, "decimal(12,2)");
});

test("extracts columns from the final SELECT in a CTE", () => {
  const sql = `
    with base as (select order_id, order_total from raw_orders)
    select order_id, order_total from base
  `;
  const columns = extractColumns(sql);

  assert.deepEqual(
    columns.map((c) => c.name),
    ["order_id", "order_total"],
  );
});

test("extracts join keys from a SQL statement with a single JOIN", () => {
  const sql =
    "select * from orders o join customers c on o.customer_id = c.customer_id where 1=1";
  const keys = extractJoinKeys(sql);

  assert.equal(keys.length, 1);
});
