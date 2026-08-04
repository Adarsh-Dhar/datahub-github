const test = require("node:test");
const assert = require("node:assert/strict");
const { appendReviewNote } = require("../src/datahub/writeback");

const NOTE = "[PR Guardian] Reviewed in PR #42. Severity: high.";

test("appends a PR Guardian review note beneath an existing description", () => {
  const result = appendReviewNote("Revenue mart used by finance.", NOTE);

  assert.equal(result, `Revenue mart used by finance.\n\n${NOTE}`);
});

test("does not duplicate a PR Guardian note that is already present", () => {
  const result = appendReviewNote(NOTE, NOTE);

  assert.equal(result, NOTE);
});
