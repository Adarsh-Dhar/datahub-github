const { getChangedModels, diffModel } = require("./github/diffParser");
const { getDownstreamImpact } = require("./datahub/lineage");
const { summarizeRisk } = require("./analysis/riskSummary");
const { hasBreakingChange } = require("./analysis/schemaChange");
const { upsertComment } = require("./github/prComment");
const { reviewWithAgent } = require("./agent/reviewAgent");
const config = require("./config");

const SEVERITY_EMOJI = { low: "🟢", medium: "🟡", high: "🔴" };

function changeDetails(diff) {
  const details = [];
  if (diff.droppedColumns.length) details.push("Dropped columns: " + diff.droppedColumns.join(", "));
  if (diff.renamedColumns.length) {
    details.push(
      "Renamed columns: " +
        diff.renamedColumns.map((change) => change.from + " → " + change.to).join(", "),
    );
  }
  if (diff.typeChanges.length) {
    details.push(
      "Type changes: " +
        diff.typeChanges
          .map((change) => change.column + " (" + change.from + " → " + change.to + ")")
          .join(", "),
    );
  }
  if (diff.joinKeyChanges.removed.length || diff.joinKeyChanges.added.length) {
    details.push(
      "Join-key changes: " +
        [...diff.joinKeyChanges.removed, ...diff.joinKeyChanges.added].join(", "),
    );
  }
  if (!details.length && diff.addedColumns.length) {
    details.push("Added columns: " + diff.addedColumns.join(", "));
  }
  return details.length ? details : ["No structural change detected."];
}

function renderSection(diff, downstreamImpact, assessment) {
  const affectedAssets = downstreamImpact.length
    ? downstreamImpact
        .map(
          (asset) =>
            "- " +
            asset.type +
            " " +
            asset.name +
            " (owner: " +
            (asset.owners.join(", ") || "unowned") +
            ")",
        )
        .join("\n")
    : "- None found within two downstream lineage hops.";
  return [
    "### " +
      (SEVERITY_EMOJI[assessment.severity] || "🟡") +
      " " +
      diff.modelName +
      " — " +
      assessment.severity.toUpperCase() +
      " risk",
    "",
    ...changeDetails(diff).map((detail) => "**" + detail.split(": ")[0] + ":** " + detail.split(": ").slice(1).join(": ")),
    "**Downstream assets affected:** " + downstreamImpact.length,
    affectedAssets,
    "",
    assessment.summary,
  ].join("\n");
}

async function run() {
  const changedFiles = getChangedModels();
  if (!changedFiles.length) {
    console.log("No dbt model changes detected.");
    return;
  }

  const skipDatahub = process.env.SKIP_DATAHUB === "true";
  if (skipDatahub) {
    console.log("Skipping DataHub lineage calls (SKIP_DATAHUB=true).");
  }

  const sections = [];
  const debugInfo = []; // Collect debug info for all files
  
  for (const file of changedFiles) {
    const diff = diffModel(file);
    if (diff.isNew) {
      console.log("Skipping new model " + diff.modelName + "; it has no existing lineage.");
      continue;
    }
    
    // Collect debug info for join keys and SQL content
    debugInfo.push(`**${diff.modelName} Join Keys:**`);
    debugInfo.push(`- Removed: ${JSON.stringify(diff.joinKeyChanges?.removed || [])}`);
    debugInfo.push(`- Added: ${JSON.stringify(diff.joinKeyChanges?.added || [])}`);
    debugInfo.push(`**${diff.modelName} Base SQL length:** ${diff.baseSql?.length || 0}`);
    debugInfo.push(`**${diff.modelName} Head SQL length:** ${diff.headSql?.length || 0}`);
    
    if (!hasBreakingChange(diff)) {
      console.log("No breaking schema change detected for " + diff.modelName + ".");
      continue;
    }

    const agentResult = skipDatahub || !config.geminiApiKey
      ? { severity: "medium", summary: "DataHub agent skipped for this run." }
      : await reviewWithAgent(diff, config);
    
    // Fallback to old lineage/risk path if agent is skipped
    const downstreamImpact = (skipDatahub || !config.geminiApiKey) ? [] : await getDownstreamImpact(diff.modelName);
    const assessment = (skipDatahub || !config.geminiApiKey) 
      ? await summarizeRisk(diff, downstreamImpact)
      : { severity: agentResult.severity, summary: agentResult.summary };
    
    sections.push(renderSection(diff, downstreamImpact, assessment));
  }

  const body = sections.length
    ? "## 🛡️ DataHub PR Guardian\n\n" + sections.join("\n\n---\n\n")
    : "✅ **DataHub PR Guardian:** no breaking schema changes detected.\n\n" + 
      (debugInfo.length ? "## 🔍 Debug Info\n\n" + debugInfo.join("\n") : "");
  const result = await upsertComment(body);
  console.log("PR Guardian comment " + result.action + ".");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
