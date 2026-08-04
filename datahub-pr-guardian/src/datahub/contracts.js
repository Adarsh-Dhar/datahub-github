const { graphqlRequest, modelNameToUrn } = require("./client");

const CONTRACT_QUERY = `
  query GetContract($urn: String!) {
    dataset(urn: $urn) {
      contract {
        properties {
          schema { assertion { info { schemaAssertion { fields { path type } } } } }
        }
      }
    }
  }
`.trim();

async function getContractFields(config, modelName) {
  const urn = modelNameToUrn(config, modelName);
  const data = await graphqlRequest(config, CONTRACT_QUERY, { urn });
  const schemaAssertions = data?.dataset?.contract?.properties?.schema || [];
  return schemaAssertions.flatMap(
    (s) => s.assertion?.info?.schemaAssertion?.fields || []
  );
}

module.exports = { getContractFields };
