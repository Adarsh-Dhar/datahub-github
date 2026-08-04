const { graphqlRequest, modelNameToUrn } = require("./client");

const DOWNSTREAM_QUERY = `
  query GetDownstream($urn: String!) {
    searchAcrossLineage(
      input: {
        urn: $urn
        query: "*"
        count: 50
        start: 0
        direction: DOWNSTREAM
        orFilters: [{ and: [{ field: "degree", condition: EQUAL, values: ["1", "2"] }] }]
      }
    ) {
      searchResults {
        degree
        entity {
          urn
          type
          ... on Dataset {
            name
            deprecation { deprecated note decommissionTime }
            ownership { owners { owner { ... on CorpUser { username properties { email } } } } }
          }
          ... on Dashboard {
            dashboardId
            tool
            ownership { owners { owner { ... on CorpUser { username properties { email } } } } }
          }
        }
      }
    }
  }
`.trim();

function ownerNames(entity) {
  return (entity.ownership?.owners || [])
    .map((ownership) => {
      const owner = ownership.owner || {};
      return owner.username || owner.properties?.email;
    })
    .filter(Boolean);
}

function canonicalAssetName(name) {
  // dbt entities use model names (for example, "fct_revenue"), while the
  // matching DuckDB entity is qualified ("pr_guardian_demo.main.fct_revenue").
  // Use the final identifier so the same logical asset appears once in a PR.
  return String(name || "").trim().toLowerCase().split(".").at(-1);
}

function dedupeImpactByName(assets) {
  const byName = new Map();

  for (const asset of assets) {
    const key = `${asset.type}:${canonicalAssetName(asset.name)}`;

    if (byName.has(key)) {
      // Prefer the closest lineage edge, but retain owners recorded on either
      // representation of the same logical asset.
      const existing = byName.get(key);
      const preferred = asset.degree < existing.degree ? asset : existing;
      const other = preferred === asset ? existing : asset;
      byName.set(key, {
        ...preferred,
        owners: [...new Set([...preferred.owners, ...other.owners])],
      });
      continue;
    }

    byName.set(key, asset);
  }

  return [...byName.values()];
}

async function getDownstreamImpact(config, modelName) {
  const urn = modelNameToUrn(config, modelName);
  const data = await graphqlRequest(config, DOWNSTREAM_QUERY, { urn });
  const results = data?.searchAcrossLineage?.searchResults || [];

  const assets = results.map((result) => {
    const entity = result.entity;
    return {
      urn: entity.urn,
      type: entity.type,
      name: entity.name || entity.dashboardId || entity.urn,
      degree: result.degree,
      owners: ownerNames(entity),
      deprecation: entity.deprecation,
    };
  });

  return dedupeImpactByName(assets);
}

module.exports = { DOWNSTREAM_QUERY, dedupeImpactByName, getDownstreamImpact };
