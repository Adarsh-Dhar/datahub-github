module.exports = {
  githubToken: process.env.GITHUB_TOKEN,
  datahubGmsUrl: process.env.DATAHUB_GMS_URL,
  datahubToken: process.env.DATAHUB_TOKEN,
  llmToken: process.env.LLM_TOKEN,
  geminiApiKey: process.env.GEMINI_API_KEY,
  allowMutations: process.env.ALLOW_DATAHUB_MUTATIONS === "true",
  prNumber: process.env.PR_NUMBER,
  repoOwner: process.env.REPO_OWNER,
  repoName: process.env.REPO_NAME,
  baseSha: process.env.BASE_SHA,
  headSha: process.env.HEAD_SHA,
  // Adjust these values to match the dataset URNs created by your dbt ingestion.
  platform: process.env.DATAHUB_PLATFORM || "dbt",
  env: process.env.DATAHUB_ENV || "PROD",
  datasetPrefix: process.env.DATAHUB_DATASET_PREFIX || "",
};
