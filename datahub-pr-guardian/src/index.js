const { getChangedModels, diffModel } = require("./github/diffParser");
const { hasBreakingChange } = require("./analysis/schemaChange");
const { upsertComment } = require("./github/prComment");
const { renderSection } = require("./github/commentRenderer");
const { createRiskStrategy } = require("./analysis/riskStrategy");
const config = require("./config");

const COMMENT_HEADER = "## 🛡️ DataHub PR Guardian";
const NO_CHANGES_BODY = "✅ **DataHub PR Guardian:** no breaking schema changes detected.";

// Processes a single changed SQL file and returns a rendered comment section,
// or null if the model should be skipped.
async function processModel(file, riskStrategy) {
  const diff = diffModel(config, file);

  if (diff.isNew) {
    console.log(`Skipping new model ${diff.modelName}; it has no existing lineage.`);
    return null;
  }
  if (!hasBreakingChange(diff)) {
    console.log(`No breaking schema change detected for ${diff.modelName}.`);
    return null;
  }

  const { assessment, downstreamImpact } = await riskStrategy.evaluate(diff);
  return renderSection(diff, downstreamImpact, assessment);
}

function buildCommentBody(sections) {
  if (!sections.length) return NO_CHANGES_BODY;
  return `${COMMENT_HEADER}\n\n${sections.join("\n\n---\n\n")}`;
}

async function run() {
  const changedFiles = getChangedModels(config);
  if (!changedFiles.length) {
    console.log("No dbt model changes detected.");
    return;
  }

  const riskStrategy = createRiskStrategy(config);
  riskStrategy.logStartupNotice();

  const sections = (
    await Promise.all(changedFiles.map((file) => processModel(file, riskStrategy)))
  ).filter(Boolean);

  const result = await upsertComment(config, buildCommentBody(sections));
  console.log(`PR Guardian comment ${result.action}.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
