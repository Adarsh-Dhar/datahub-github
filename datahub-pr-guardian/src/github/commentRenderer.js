// Regex used by both the PR comment renderer and the writeback runner to
// extract model names and severities from an existing Guardian comment body.
const RISK_SECTION_PATTERN = /### .+?\s+([\w-]+)\s+—\s+(LOW|MEDIUM|HIGH) risk/g;

const SEVERITY_EMOJI = { low: "🟢", medium: "🟡", high: "🔴" };

function formatChangeDetails(diff) {
  const details = [];

  if (diff.droppedColumns.length) {
    details.push(`Dropped columns: ${diff.droppedColumns.join(", ")}`);
  }
  if (diff.renamedColumns.length) {
    const renamed = diff.renamedColumns.map((c) => `${c.from} → ${c.to}`).join(", ");
    details.push(`Renamed columns: ${renamed}`);
  }
  if (diff.typeChanges.length) {
    const types = diff.typeChanges.map((c) => `${c.column} (${c.from} → ${c.to})`).join(", ");
    details.push(`Type changes: ${types}`);
  }
  if (diff.joinKeyChanges.removed.length || diff.joinKeyChanges.added.length) {
    const keys = [...diff.joinKeyChanges.removed, ...diff.joinKeyChanges.added].join(", ");
    details.push(`Join-key changes: ${keys}`);
  }
  if (!details.length && diff.addedColumns.length) {
    details.push(`Added columns: ${diff.addedColumns.join(", ")}`);
  }

  return details.length ? details : ["No structural change detected."];
}

function formatAffectedAssets(downstreamImpact) {
  if (!downstreamImpact.length) return "- None found within two downstream lineage hops.";
  return downstreamImpact
    .map((asset) => {
      const owners = asset.owners.join(", ") || "unowned";
      return `- ${asset.type} ${asset.name} (owner: ${owners})`;
    })
    .join("\n");
}

function renderSection(diff, downstreamImpact, assessment) {
  const emoji = SEVERITY_EMOJI[assessment.severity] || "🟡";
  const severityLabel = assessment.severity.toUpperCase();
  const header = `### ${emoji} ${diff.modelName} — ${severityLabel} risk`;

  const changeLines = formatChangeDetails(diff).map((detail) => {
    const separatorIndex = detail.indexOf(": ");
    const label = detail.slice(0, separatorIndex);
    const value = detail.slice(separatorIndex + 2);
    return `**${label}:** ${value}`;
  });

  return [
    header,
    "",
    ...changeLines,
    `**Downstream assets affected:** ${downstreamImpact.length}`,
    formatAffectedAssets(downstreamImpact),
    "",
    assessment.summary,
  ].join("\n");
}

module.exports = { RISK_SECTION_PATTERN, SEVERITY_EMOJI, formatChangeDetails, renderSection };
