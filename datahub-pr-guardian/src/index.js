const { getChangedModels, diffModel } = require("./github/diffParser");
const { getDownstreamImpact } = require("./datahub/lineage");
const { summarizeRisk } = require("./analysis/riskSummary");
const { hasBreakingChange } = require("./analysis/schemaChange");
const { upsertComment } = require("./github/prComment");
const { renderSection } = require("./github/commentRenderer");
const { reviewWithAgent } = require("./agent/reviewAgent");
const config = require("./config");

const COMMENT_HEADER = "## 🛡️ DataHub PR Guardian";
const NO_CHANGES_BODY = "✅ **DataHub PR Guardian:** no breaking schema changes detected.";

// Returns { assessment, downstreamImpact } for the given diff.
// Uses the Gemini agent when an API key is configured, otherwise falls back
// to the DataHub lineage + LLM risk-summary path.
async function evaluateRisk(diff) {
  if (config.geminiApiKey) {
    const agentResult = await reviewWithAgent(diff, config);
    return {
      assessment: { severity: agentResult.severity, summary: agentResult.summary },
      downstreamImpact: [],
    };
  }

  const downstreamImpact = config.skipDatahub
    ? []
    : await getDownstreamImpact(diff.modelName);

  return {
    assessment: await summarizeRisk(diff, downstreamImpact),
    downstreamImpact,
  };
}

// Processes a single changed SQL file and returns a rendered comment section,
// or null if the model should be skipped.
async function processModel(file) {
  const diff = diffModel(file);

  if (diff.isNew) {
    console.log(`Skipping new model ${diff.modelName}; it has no existing lineage.`);
    return null;
  }
  if (!hasBreakingChange(diff)) {
    console.log(`No breaking schema change detected for ${diff.modelName}.`);
    return null;
  }

  const { assessment, downstreamImpact } = await evaluateRisk(diff);
  return renderSection(diff, downstreamImpact, assessment);
}

function buildCommentBody(sections) {
  if (!sections.length) return NO_CHANGES_BODY;
  return `${COMMENT_HEADER}\n\n${sections.join("\n\n---\n\n")}`;
}

async function run() {
  const changedFiles = getChangedModels();
  if (!changedFiles.length) {
    console.log("No dbt model changes detected.");
    return;
  }

  if (config.skipDatahub) {
    console.log("Skipping DataHub lineage calls (SKIP_DATAHUB=true).");
  }

  const sections = (await Promise.all(changedFiles.map(processModel))).filter(Boolean);
  const result = await upsertComment(buildCommentBody(sections));
  console.log(`PR Guardian comment ${result.action}.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
