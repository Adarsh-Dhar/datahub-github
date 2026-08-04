const test = require("node:test");
const assert = require("node:assert/strict");
const { dedupeImpactByName } = require("../src/datahub/lineage");

const dimCustomersDbt = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,pr_guardian_demo.main.dim_customers,PROD)",
  type: "DATASET",
  name: "dim_customers",
  degree: 1,
  owners: ["analytics@example.com"],
};

const dimCustomersDuckdb = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:duckdb,pr_guardian_demo.main.dim_customers,PROD)",
  type: "DATASET",
  name: "pr_guardian_demo.main.dim_customers",
  degree: 2,
  owners: ["finance@example.com"],
};

const fctRevenueDbt = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,pr_guardian_demo.main.fct_revenue,PROD)",
  type: "DATASET",
  name: "fct_revenue",
  degree: 1,
  owners: [],
};

const fctRevenueDuckdb = {
  urn: "urn:li:dataset:(urn:li:dataPlatform:duckdb,pr_guardian_demo.main.fct_revenue,PROD)",
  type: "DATASET",
  name: "pr_guardian_demo.main.fct_revenue",
  degree: 2,
  owners: [],
};

const allAssets = [dimCustomersDbt, dimCustomersDuckdb, fctRevenueDbt, fctRevenueDuckdb];

test("deduplicates dbt and DuckDB representations into one entry per logical asset", () => {
  const result = dedupeImpactByName(allAssets);

  assert.equal(result.length, 2);
});

test("prefers the lower-degree entry when deduplicating", () => {
  const result = dedupeImpactByName(allAssets);
  const dimCustomers = result.find((asset) => asset.name === "dim_customers");

  assert.equal(dimCustomers.degree, 1);
});

test("merges owners from both representations of the same logical asset", () => {
  const result = dedupeImpactByName(allAssets);
  const dimCustomers = result.find((asset) => asset.name === "dim_customers");

  assert.deepEqual(dimCustomers.owners, ["analytics@example.com", "finance@example.com"]);
});
