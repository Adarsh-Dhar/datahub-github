const { graphqlRequest, modelNameToUrn } = require("./client");

// Confirm this mutation and input shape against the DataHub version you deploy.
const WRITEBACK_MUTATION = [
  "mutation UpdateDescription($input: DescriptionUpdateInput!) {",
  "  updateDescription(input: $input)",
  "}",
].join("\n");

const CURRENT_DESCRIPTION_QUERY = [
  "query CurrentDescription($urn: String!) {",
  "  dataset(urn: $urn) {",
  "    properties { description }",
  "    editableProperties { description }",
  "  }",
  "}",
].join("\n");

function appendReviewNote(existingDescription, note) {
  const current = existingDescription?.trim();
  if (!current) return note;

  // The note text is deterministic per (PR, model, severity), e.g.
  // "[PR Guardian] Reviewed in PR #123. Severity: medium." — so an exact
  // substring match is a reliable dedupe key. A second writeback call for
  // the SAME PR produces the identical string and is skipped; a genuinely
  // different PR (even a numerically nearby one) produces different text
  // and is appended, as it should be.
  if (current.includes(note)) {
    console.log("Skipping duplicate note (already present): " + note);
    return current;
  }

  return current + "\n\n" + note;
}

async function writeIncidentNote(modelName, prNumber, summary) {
  const urn = modelNameToUrn(modelName);
  const note = "[PR Guardian] Reviewed in PR #" + prNumber + ". " + summary;
  const current = await graphqlRequest(CURRENT_DESCRIPTION_QUERY, { urn });
  const existingDescription =
    current?.dataset?.editableProperties?.description ||
    current?.dataset?.properties?.description ||
    "";
  const description = appendReviewNote(existingDescription, note);

  if (description === existingDescription) {
    return { updateDescription: false, skipped: true };
  }

  const result = await graphqlRequest(WRITEBACK_MUTATION, {
    input: { resourceUrn: urn, description },
  });
  return { updateDescription: true, skipped: false, result };
}

module.exports = {
  WRITEBACK_MUTATION,
  CURRENT_DESCRIPTION_QUERY,
  appendReviewNote,
  writeIncidentNote,
};