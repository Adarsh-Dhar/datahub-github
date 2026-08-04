const { graphqlRequest, modelNameToUrn } = require("./client");

const SCHEMA_QUERY = `
  query GetSchema($urn: String!) {
    dataset(urn: $urn) {
      schemaMetadata { fields { fieldPath nativeDataType } }
    }
  }
`.trim();

async function getUpstreamSchema(config, tableName) {
  const urn = modelNameToUrn(config, tableName);
  const data = await graphqlRequest(config, SCHEMA_QUERY, { urn });
  const fields = data?.dataset?.schemaMetadata?.fields || [];
  return new Set(fields.map((f) => f.fieldPath.toLowerCase()));
}

module.exports = { getUpstreamSchema };
