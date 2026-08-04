const { Octokit } = require("@octokit/rest");
const { writeIncidentNote } = require("./datahub/writeback");
const { MARKER } = require("./github/prComment");
const { RISK_SECTION_PATTERN } = require("./github/commentRenderer");
const config = require("./config");

async function run() {
  if (!config.githubToken) throw new Error("GITHUB_TOKEN is required for writeback.");

  const octokit = new Octokit({ auth: config.githubToken });
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner: config.repoOwner,
    repo: config.repoName,
    issue_number: Number(config.prNumber),
    per_page: 100,
  });

  const guardianComment = comments.find((comment) => comment.body?.includes(MARKER));
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
