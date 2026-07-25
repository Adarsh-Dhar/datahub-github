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

function appendReviewNote(existingDescription, note, modelName, prNumber, summary) {
  const current = existingDescription?.trim();
  if (!current) return note;
  
  // Check for duplicate severity changes on the same model within a time window (24 hours)
  const timeWindow = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  const now = Date.now();
  const notePattern = /\[PR Guardian\] Reviewed in PR #(\d+)\. Severity: (low|medium|high)\./gi;
  let match;
  const recentNotes = [];
  
  while ((match = notePattern.exec(current)) !== null) {
    const notePrNumber = parseInt(match[1]);
    const noteSeverity = match[2].toLowerCase();
    // Extract timestamp if available, otherwise assume recent
    recentNotes.push({ prNumber: notePrNumber, severity: noteSeverity });
  }
  
  // Check if there's a recent note for the same model with the same severity
  const currentSeverity = summary.toLowerCase().replace("severity: ", "").replace(".", "");
  const hasDuplicate = recentNotes.some(n => 
    n.severity === currentSeverity && 
    Math.abs(n.prNumber - prNumber) < 100 // PR numbers close in time
  );
  
  if (hasDuplicate) {
    console.log(`Skipping duplicate note for ${modelName} with severity ${currentSeverity}`);
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
  const description = appendReviewNote(existingDescription, note, modelName, prNumber, summary);

  if (description === existingDescription) {
    return { updateDescription: false, skipped: true };
  }

  return graphqlRequest(WRITEBACK_MUTATION, {
    input: { resourceUrn: urn, description },
  });
}

module.exports = {
  WRITEBACK_MUTATION,
  CURRENT_DESCRIPTION_QUERY,
  appendReviewNote,
  writeIncidentNote,
};
