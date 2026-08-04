const { graphqlRequest, modelNameToUrn } = require("./client");

const SELF_STATUS_QUERY = `
  query GetSelfStatus($urn: String!) {
    dataset(urn: $urn) {
      deprecation { deprecated note }
    }
  }
`.trim();

async function getSelfDeprecation(config, modelName) {
  const urn = modelNameToUrn(config, modelName);
  const data = await graphqlRequest(config, SELF_STATUS_QUERY, { urn });
  return data?.dataset?.deprecation || { deprecated: false, note: null };
}

async function getDeprecationFlags(config, modelName, downstreamImpact) {
  const selfDeprecation = await getSelfDeprecation(config, modelName);
  const downstreamDeprecations = downstreamImpact
    .filter((asset) => asset.deprecation?.deprecated)
    .map((asset) => ({
      name: asset.name,
      note: asset.deprecation.note,
    }));

  const flags = [];
  if (selfDeprecation.deprecated) {
    flags.push({
      asset: modelName,
      note: selfDeprecation.note,
    });
  }
  flags.push(...downstreamDeprecations);

  return flags;
}

module.exports = { getDeprecationFlags };
