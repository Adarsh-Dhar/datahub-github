const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReviewPrompt, parseAgentResult } = require("../src/agent/reviewAgent");

const sampleDiff = {
  modelName: "stg_orders",
  droppedColumns: ["customer_id"],
  renamedColumns: [],
  typeChanges: [{ column: "revenue", from: "decimal(12,2)", to: "bigint" }],
  joinKeyChanges: { removed: [], added: [] },
};

test("buildReviewPrompt includes the model name", () => {
  const prompt = buildReviewPrompt(sampleDiff);

  assert.ok(prompt.includes("stg_orders"));
});

test("buildReviewPrompt includes the dropped columns", () => {
  const prompt = buildReviewPrompt(sampleDiff);

  assert.ok(prompt.includes("customer_id"));
});

test("parseAgentResult extracts severity and summary from valid JSON embedded in text", () => {
  const text = 'Here is my analysis.\n{"severity":"high","summary":"Breaking change detected."}';
  const result = parseAgentResult(text);

  assert.equal(result.severity, "high");
});

test("parseAgentResult returns null for text with no JSON object", () => {
  const result = parseAgentResult("No JSON here at all.");

  assert.equal(result, null);
});

test("parseAgentResult returns null for malformed JSON", () => {
  const result = parseAgentResult("{severity: high, summary: oops}");

  assert.equal(result, null);
});
