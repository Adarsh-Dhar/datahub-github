// Matches source_table="x", destination_table="x", table="x" kwargs,
// and bare SQL strings passed to Operators (BigQueryOperator, PostgresOperator, etc).
const TABLE_KWARG_PATTERN = /\b(?:source_table|destination_table|table|dataset_table)\s*=\s*["']([\w.\-]+)["']/g;
const SQL_KWARG_PATTERN = /\bsql\s*=\s*(?:f?["']{1,3})([\s\S]*?)(?:["']{1,3})\s*[,)]/g;

function extractTableRefs(pyContent) {
  const direct = [...pyContent.matchAll(TABLE_KWARG_PATTERN)].map((m) => m[1]);
  const embeddedSql = [...pyContent.matchAll(SQL_KWARG_PATTERN)].map((m) => m[1]);
  return { directTables: [...new Set(direct)], embeddedSql };
}

function extractDagId(pyContent) {
  const match = pyContent.match(/dag_id\s*=\s*["'](\w+)["']/);
  return match ? match[1] : null;
}

module.exports = { extractTableRefs, extractDagId };
