const { execFileSync } = require("child_process");
const fs = require("fs");
const { analyzeSchemaChange } = require("../analysis/schemaChange");
const { extractColumns } = require("../analysis/sqlParser");

function requireGitRef(name, value) {
  if (!value) throw new Error(`${name} is required to calculate the pull-request diff.`);
  return value;
}

function modelNameFromPath(filePath) {
  return filePath.split("/").pop().replace(/\.sql$/, "");
}

// Returns changed dbt model files between the pull request base and head commits.
function getChangedModels(config) {
  const baseSha = requireGitRef("BASE_SHA", config.baseSha);
  const headSha = requireGitRef("HEAD_SHA", config.headSha);

  const diffOutput = execFileSync("git", ["diff", "--name-only", baseSha, headSha]).toString();

  return diffOutput
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file.endsWith(".sql") && file.includes("models/"));
}

function diffModel(config, filePath) {
  const headContent = fs.readFileSync(filePath, "utf8");
  const modelName = modelNameFromPath(filePath);
  let baseContent;

  try {
    baseContent = execFileSync("git", [
      "show",
      `${requireGitRef("BASE_SHA", config.baseSha)}:${filePath}`,
    ]).toString();
  } catch {
    return {
      modelPath: filePath,
      modelName,
      isNew: true,
      ...analyzeSchemaChange("", headContent),
      addedColumns: extractColumns(headContent).map((column) => column.name),
    };
  }

  return {
    modelPath: filePath,
    modelName,
    isNew: false,
    baseSql: baseContent,
    headSql: headContent,
    ...analyzeSchemaChange(baseContent, headContent),
  };
}

module.exports = { getChangedModels, diffModel };
