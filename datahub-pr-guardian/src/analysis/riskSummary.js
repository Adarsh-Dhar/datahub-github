const { Severity } = require("../domain/severity");

const LLM_MODEL_ID = "openai/gpt-4o-mini";
const GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions";

function determineFallbackSeverity(hasStructuralBreak, hasDownstreamImpact) {
  if (hasStructuralBreak && hasDownstreamImpact) return new Severity("high");
  if (hasStructuralBreak) return new Severity("medium");
  return new Severity("low");
}

function fallbackRisk(modelDiff, downstreamImpact) {
  const hasStructuralBreak = Boolean(
    modelDiff.droppedColumns.length ||
      modelDiff.renamedColumns?.length ||
      modelDiff.typeChanges?.length ||
      modelDiff.joinKeyChanges?.removed?.length ||
      modelDiff.joinKeyChanges?.added?.length,
  );
  const hasDownstreamImpact = downstreamImpact.length > 0;
  const severity = determineFallbackSeverity(hasStructuralBreak, hasDownstreamImpact);

  const owners = [...new Set(downstreamImpact.flatMap((asset) => asset.owners))];
  const ownerNote = owners.length
    ? `Ask ${owners.join(", ")} to review before merging.`
    : "No downstream owner is recorded in DataHub.";
  const changeNote = hasStructuralBreak
    ? "a structural change"
    : "a non-breaking additive change";

  return {
    severity,
    summary: `Detected ${changeNote} affecting ${downstreamImpact.length} downstream asset(s). ${ownerNote}`,
  };
}

function formatRenamedColumns(renamedColumns = []) {
  return renamedColumns.map((change) => `${change.from} -> ${change.to}`).join(", ") || "none";
}

function formatTypeChanges(typeChanges = []) {
  return (
    typeChanges
      .map((change) => `${change.column} (${change.from} -> ${change.to})`)
      .join(", ") || "none"
  );
}

function formatDownstreamConsumers(downstreamImpact) {
  if (!downstreamImpact.length) return "none";
  return downstreamImpact
    .map((asset) => {
      const owners = asset.owners.join(", ") || "unowned";
      return `- ${asset.type} "${asset.name}" (degree ${asset.degree}), owners: ${owners}`;
    })
    .join("\n");
}

function buildRiskPrompt(modelDiff, downstreamImpact) {
  return `You are a senior data engineer reviewing a dbt model change for breaking impact.

Model: ${modelDiff.modelName}
Dropped columns: ${modelDiff.droppedColumns.join(", ") || "none"}
Renamed columns: ${formatRenamedColumns(modelDiff.renamedColumns)}
Type changes: ${formatTypeChanges(modelDiff.typeChanges)}
Changed join keys: ${(modelDiff.joinKeyChanges?.removed || []).join(", ") || "none"}
Added columns: ${modelDiff.addedColumns.join(", ") || "none"}

Downstream consumers (from the lineage graph):
${formatDownstreamConsumers(downstreamImpact)}

In 3-4 sentences, state the concrete risk, who should review it, and include a line formatted Severity: low, medium, or high.`;
}

async function summarizeRisk(config, modelDiff, downstreamImpact) {
  if (!config.llmToken) return fallbackRisk(modelDiff, downstreamImpact);

  const response = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llmToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL_ID,
      messages: [{ role: "user", content: buildRiskPrompt(modelDiff, downstreamImpact) }],
      temperature: 0.2,
    }),
  });

  const responseJson = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GitHub Models request failed (${response.status}).`);
  }

  const summary = responseJson.choices?.[0]?.message?.content?.trim();
  if (!summary) return fallbackRisk(modelDiff, downstreamImpact);

  return { severity: Severity.fromText(summary), summary };
}

module.exports = {
  fallbackRisk,
  determineFallbackSeverity,
  buildRiskPrompt,
  summarizeRisk,
};
