const test = require("node:test");
const assert = require("node:assert/strict");
const { retryDelayMs } = require("../src/datahub/client");

test("retryDelayMs returns 1000ms for attempt 0", () => {
  assert.equal(retryDelayMs(0), 1_000);
});

test("retryDelayMs returns 2000ms for attempt 1", () => {
  assert.equal(retryDelayMs(1), 2_000);
});

test("retryDelayMs returns 4000ms for attempt 2", () => {
  assert.equal(retryDelayMs(2), 4_000);
});
