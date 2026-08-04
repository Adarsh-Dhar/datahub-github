const { writeIncidentNote } = require("./datahub/writeback");
const { findGuardianComment } = require("./github/prComment");
const { RISK_SECTION_PATTERN } = require("./github/commentRenderer");
const config = require("./config");

async function run() {
  if (!config.githubToken) throw new Error("GITHUB_TOKEN is required for writeback.");

  const guardianComment = await findGuardianComment(config);
  if (!guardianComment) {
    console.log("No PR Guardian comment found; skipping DataHub writeback.");
    return;
  }

  const modelMatches = [...guardianComment.body.matchAll(RISK_SECTION_PATTERN)];
  for (const [, modelName, severity] of modelMatches) {
    const result = await writeIncidentNote(
      config,
      modelName,
      config.prNumber,
      `Severity: ${severity.toLowerCase()}.`,
    );
    if (result?.skipped) {
      console.log(`Skipped — review note for ${modelName} already present.`);
    } else {
      console.log(`Wrote a DataHub review note for ${modelName}.`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
