const { DatasetUrn } = require("../domain/datasetUrn");

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

function requireDataHubConfig(config) {
  if (!config.datahubGmsUrl) throw new Error("DATAHUB_GMS_URL is required.");
}

// Returns the milliseconds to wait before retry attempt N (exponential backoff).
function retryDelayMs(attempt) {
  return Math.pow(2, attempt) * RETRY_BASE_DELAY_MS;
}

async function graphqlRequest(config, query, variables = {}) {
  requireDataHubConfig(config);

  const endpoint = new URL("/api/graphql", config.datahubGmsUrl).toString();
  const headers = { "Content-Type": "application/json" };
  if (config.datahubToken) headers.Authorization = `Bearer ${config.datahubToken}`;

  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const responseJson = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          `DataHub GraphQL request failed (${response.status}): ` +
            `${responseJson.message || JSON.stringify(responseJson)}`,
        );
      }
      if (responseJson.errors?.length) {
        throw new Error(`DataHub GraphQL error: ${JSON.stringify(responseJson.errors)}`);
      }

      return responseJson.data;
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === MAX_RETRIES - 1;
      if (!isLastAttempt) {
        const delay = retryDelayMs(attempt);
        console.warn(
          `GraphQL request failed (attempt ${attempt + 1}/${MAX_RETRIES}), ` +
            `retrying in ${delay}ms: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

function modelNameToUrn(config, modelName) {
  return DatasetUrn.forModel(modelName, config).toString();
}

module.exports = { graphqlRequest, modelNameToUrn, retryDelayMs };
