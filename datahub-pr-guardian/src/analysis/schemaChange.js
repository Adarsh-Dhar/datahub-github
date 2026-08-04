const { extractColumns, extractJoinKeys } = require("./sqlParser");

function analyzeSchemaChange(baseSql, headSql) {
  const baseColumns = extractColumns(baseSql);
  const headColumns = extractColumns(headSql);
  const baseByName = new Map(baseColumns.map((col) => [col.name, col]));
  const headByName = new Map(headColumns.map((col) => [col.name, col]));

  const droppedColumns = baseColumns
    .filter((col) => !headByName.has(col.name))
    .map((col) => col.name);

  const addedColumns = headColumns
    .filter((col) => !baseByName.has(col.name))
    .map((col) => col.name);

  const remainingAdded = new Set(addedColumns);
  const renamedColumns = [];

  for (const oldName of droppedColumns) {
    const oldColumn = baseByName.get(oldName);
    const replacement = headColumns.find(
      (col) => remainingAdded.has(col.name) && col.expression === oldColumn.expression,
    );
    if (replacement) {
      renamedColumns.push({ from: oldName, to: replacement.name });
      remainingAdded.delete(replacement.name);
    }
  }

  const typeChanges = headColumns.flatMap((col) => {
    const previous = baseByName.get(col.name);
    if (!previous || previous.type === col.type || !previous.type || !col.type) {
      return [];
    }
    return [{ column: col.name, from: previous.type, to: col.type }];
  });

  const baseJoinKeys = new Set(extractJoinKeys(baseSql));
  const headJoinKeys = new Set(extractJoinKeys(headSql));

  return {
    droppedColumns: droppedColumns.filter(
      (name) => !renamedColumns.some((rename) => rename.from === name),
    ),
    addedColumns: addedColumns.filter((name) => remainingAdded.has(name)),
    renamedColumns,
    typeChanges,
    joinKeyChanges: {
      removed: [...baseJoinKeys].filter((key) => !headJoinKeys.has(key)),
      added: [...headJoinKeys].filter((key) => !baseJoinKeys.has(key)),
    },
  };
}

function hasBreakingChange(change) {
  return Boolean(
    change.droppedColumns.length ||
      change.renamedColumns.length ||
      change.typeChanges.length ||
      change.joinKeyChanges.removed.length ||
      change.joinKeyChanges.added.length ||
      (change.removedTables && change.removedTables.length) ||
      (change.addedTables && change.addedTables.length),
  );
}

module.exports = { analyzeSchemaChange, hasBreakingChange };
