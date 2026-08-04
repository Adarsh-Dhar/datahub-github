// Greedy capture after AS — the balanced-paren walker trims the outer closing paren.
const CAST_TYPE_PATTERN = /\bcast\s*\([\s\S]*?\s+as\s+([\s\S]+)/i;
const SHORTHAND_CAST_PATTERN = /::\s*([\s\S]+)/i;
const ALIAS_PATTERN = /\s+as\s+([\w$]+)\s*$/i;

// Walks a type string from the match position, collecting characters until
// an unmatched closing parenthesis is encountered. This correctly handles
// precision types like decimal(10,2) where the inner parens are part of the type.
function extractBalancedType(expression, pattern) {
  const match = expression.match(pattern);
  if (!match) return null;

  const typePart = match[1];
  let depth = 0;
  let result = "";

  for (const char of typePart) {
    if (char === "(") {
      depth++;
      result += char;
    } else if (char === ")") {
      if (depth === 0) break;
      depth--;
      result += char;
    } else {
      result += char;
    }
  }

  return result.trim() || null;
}

function extractAlias(expression) {
  const match = expression.match(ALIAS_PATTERN);
  return match ? match[1].replace(/["`]/g, "") : null;
}

function extractColumnType(expression) {
  const castType = extractBalancedType(expression, CAST_TYPE_PATTERN);
  const shorthandType = extractBalancedType(expression, SHORTHAND_CAST_PATTERN);
  const raw = castType || shorthandType;
  return raw ? raw.replace(/\s+/g, " ").toLowerCase() : null;
}

function columnFromExpression(expression) {
  // Anchoring the alias match to the end avoids mistaking CAST(... AS type) for an alias.
  const alias = extractAlias(expression);
  const expressionWithoutAlias = alias
    ? expression.slice(0, expression.match(ALIAS_PATTERN).index).trim()
    : expression.trim();

  const fallbackName = expressionWithoutAlias
    .split(".")
    .pop()
    .replace(/["`]/g, "")
    .trim();

  return {
    name: (alias || fallbackName).replace(/["`]/g, ""),
    expression: expressionWithoutAlias.replace(/\s+/g, " ").toLowerCase(),
    type: extractColumnType(expressionWithoutAlias),
  };
}

function isValidColumn(column) {
  return Boolean(column.name) && !column.name.startsWith("--");
}

function splitSelectList(selectBody) {
  const items = [];
  let current = "";
  let depth = 0;
  let quote = null;

  for (const char of selectBody) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
    } else if (char === "(") {
      depth += 1;
      current += char;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === "," && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

function extractSelectBody(sql) {
  // Try the CTE pattern first so the final SELECT (not one inside a CTE) is matched.
  const ctePattern = /\bwith\b[\s\S]*?\)\s*\bselect\b([\s\S]*?)\bfrom\b/i;
  const normalPattern = /\bselect\b([\s\S]*?)\bfrom\b/i;
  const match = sql.match(ctePattern) || sql.match(normalPattern);
  return match ? match[1] : "";
}

function extractColumns(sql) {
  return splitSelectList(extractSelectBody(sql))
    .map(columnFromExpression)
    .filter(isValidColumn);
}

function extractJoinKeys(sql) {
  const joinPattern =
    /join\s+[\s\S]*?on\s+([^\n;]+?)(?=\s+where|\s+group|\s+order|\s+having|\s+union|\s*join|\n|$)/gi;
  return [...sql.matchAll(joinPattern)].map((match) =>
    match[1].replace(/\s+/g, " ").trim().toLowerCase(),
  );
}

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
      change.joinKeyChanges.added.length,
  );
}

module.exports = {
  analyzeSchemaChange,
  extractColumns,
  extractJoinKeys,
  hasBreakingChange,
};
