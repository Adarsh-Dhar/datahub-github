const config = require("../config");

function requireDataHubConfig() {
  if (!config.datahubGmsUrl) throw new Error("DATAHUB_GMS_URL is required.");
}

async function graphqlRequest(query, variables = {}, retries = 3) {
  requireDataHubConfig();
  const endpoint = new URL("/api/graphql", config.datahubGmsUrl).toString();
  const headers = { "Content-Type": "application/json" };
  if (config.datahubToken) headers.Authorization = "Bearer " + config.datahubToken;
  
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          "DataHub GraphQL request failed (" +
            response.status +
            "): " +
            (json.message || JSON.stringify(json)),
        );
      }
      if (json.errors?.length) {
        throw new Error("DataHub GraphQL error: " + JSON.stringify(json.errors));
      }
      return json.data;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        console.warn(`GraphQL request failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

function modelNameToUrn(modelName) {
  const datasetName = config.datasetPrefix
    ? config.datasetPrefix + "." + modelName
    : modelName;
  return (
    "urn:li:dataset:(urn:li:dataPlatform:" +
    config.platform +
    "," +
    datasetName +
    "," +
    config.env +
    ")"
  );
}

module.exports = { graphqlRequest, modelNameToUrn };
