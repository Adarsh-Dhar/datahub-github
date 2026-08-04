const { getUpstreamSchema } = require("../datahub/schema");
const { extractSourceTables, extractColumns, extractJoinKeys } = require("./sqlParser");

async function validateAgainstLiveSchema(config, headSql) {
  const sources = extractSourceTables(headSql);
  const schemasByAlias = {};
  for (const { table, alias } of sources) {
    schemasByAlias[alias] = await getUpstreamSchema(config, table).catch(() => null);
  }

  const problems = [];
  const columnRefPattern = /([\w$]+)\.([\w$]+)/g;
  const referenced = new Set(
    [...headSql.matchAll(columnRefPattern)].map((m) => `${m[1]}.${m[2].toLowerCase()}`)
  );

  for (const ref of referenced) {
    const [alias, column] = ref.split(".");
    const schema = schemasByAlias[alias];
    if (schema && !schema.has(column)) {
      problems.push(`${alias}.${column} does not exist in DataHub's schema for ${alias}`);
    }
  }
  return problems;
}

function checkContractViolations(diff, contractFields) {
  const requiredNames = new Set(contractFields.map((f) => f.path.toLowerCase()));
  const droppedColumns = diff.droppedColumns || [];
  const typeChanges = diff.typeChanges || [];
  const violations = droppedColumns.filter((c) => requiredNames.has(c.toLowerCase()));
  const typeViolations = typeChanges.filter((t) =>
    requiredNames.has(t.column.toLowerCase())
  );
  return { violations, typeViolations };
}

module.exports = { validateAgainstLiveSchema, checkContractViolations };
