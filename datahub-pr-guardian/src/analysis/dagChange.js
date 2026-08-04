const { extractTableRefs } = require("./dagParser");
const { extractColumns, extractJoinKeys } = require("./sqlParser");

function analyzeDagChange(baseContent, headContent) {
  const base = extractTableRefs(baseContent);
  const head = extractTableRefs(headContent);

  const removedTables = base.directTables.filter((t) => !head.directTables.includes(t));
  const addedTables = head.directTables.filter((t) => !base.directTables.includes(t));

  // Reuse the SQL diff logic against any embedded SQL blocks (e.g. BigQueryOperator sql=...)
  const baseSql = base.embeddedSql.join("\n");
  const headSql = head.embeddedSql.join("\n");
  const droppedColumns = extractColumns(baseSql)
    .map((c) => c.name)
    .filter((name) => !extractColumns(headSql).some((c) => c.name === name));
  const joinKeyChanges = {
    removed: extractJoinKeys(baseSql).filter((k) => !extractJoinKeys(headSql).includes(k)),
    added: extractJoinKeys(headSql).filter((k) => !extractJoinKeys(baseSql).includes(k)),
  };

  return { removedTables, addedTables, droppedColumns, addedColumns: [], renamedColumns: [], typeChanges: [], joinKeyChanges };
}

module.exports = { analyzeDagChange };
