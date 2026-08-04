const { execFileSync } = require("child_process");
const fs = require("fs");
const { analyzeSchemaChange } = require("../analysis/schemaChange");
const { extractColumns } = require("../analysis/sqlParser");
const { analyzeDagChange } = require("../analysis/dagChange");
const { extractDagId } = require("../analysis/dagParser");

function requireGitRef(name, value) {
  if (!value) throw new Error(`${name} is required to calculate the pull-request diff.`);
  return value;
}

function modelNameFromPath(filePath) {
  return filePath.split("/").pop().replace(/\.(sql|py)$/, "");
}

// Returns changed dbt model files and Airflow DAG files between the pull request base and head commits.
function getChangedModels(config) {
  const baseSha = requireGitRef("BASE_SHA", config.baseSha);
  const headSha = requireGitRef("HEAD_SHA", config.headSha);

  const diffOutput = execFileSync("git", ["diff", "--name-only", baseSha, headSha]).toString();

  return diffOutput
    .split("\n")
    .map((file) => file.trim())
    .filter((file) =>
      (file.endsWith(".sql") && file.includes("models/")) ||
      (file.endsWith(".py") && file.includes("dags/"))
    );
}

function diffModel(config, filePath) {
  const headContent = fs.readFileSync(filePath, "utf8");
  const isDag = filePath.endsWith(".py");
  const modelName = isDag 
    ? extractDagId(headContent) || modelNameFromPath(filePath)
    : modelNameFromPath(filePath);
  let baseContent;

  try {
    baseContent = execFileSync("git", [
      "show",
      `${requireGitRef("BASE_SHA", config.baseSha)}:${filePath}`,
    ]).toString();
  } catch {
    if (isDag) {
      return {
        modelPath: filePath,
        modelName,
        isNew: true,
        ...analyzeDagChange("", headContent),
      };
    }
    return {
      modelPath: filePath,
      modelName,
      isNew: true,
      ...analyzeSchemaChange("", headContent),
      addedColumns: extractColumns(headContent).map((column) => column.name),
    };
  }

  if (isDag) {
    return {
      modelPath: filePath,
      modelName,
      isNew: false,
      ...analyzeDagChange(baseContent, headContent),
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
