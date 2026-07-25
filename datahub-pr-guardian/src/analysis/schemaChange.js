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
  // Handle CTEs by finding the last SELECT before FROM
  const ctePattern = /\bwith\b[\s\S]*?\)\s*\bselect\b([\s\S]*?)\bfrom\b/i;
  const normalPattern = /\bselect\b([\s\S]*?)\bfrom\b/i;
  
  // Try CTE pattern first, then normal pattern
  const match = sql.match(ctePattern) || sql.match(normalPattern);
  return match ? match[1] : "";
}

function columnFromExpression(expression) {
  // Anchoring to the end avoids mistaking CAST(... AS type) for an alias.
  const aliasMatch = expression.match(/\s+as\s+([\w$]+)\s*$/i);
  const expressionWithoutAlias = aliasMatch
    ? expression.slice(0, aliasMatch.index).trim()
    : expression.trim();
  const fallbackName = expressionWithoutAlias
    .split(".")
    .pop()
    .replace(/["`]/g, "")
    .trim();
  const name = (aliasMatch?.[1] || fallbackName).replace(/["`]/g, "");
  const castTypeMatch = expressionWithoutAlias.match(
    /\bcast\s*\([\s\S]*?\s+as\s+([a-z][\w]*(?:\s*\([^)]*\))?)/i,
  );
  const shorthandTypeMatch = expressionWithoutAlias.match(
    /::\s*([a-z][\w]*(?:\s*\([^)]*\))?)/i,
  );

  // Extract full type including numbers and commas for precision types like decimal(10, 2)
  // Use a function to handle balanced parentheses properly
  const extractCastType = (expr, pattern) => {
    const match = expr.match(pattern);
    if (!match) return null;
    const typePart = match[1];
    let depth = 0;
    let result = "";
    for (let i = 0; i < typePart.length; i++) {
      const char = typePart[i];
      if (char === "(") depth++;
      else if (char === ")") {
        if (depth === 0) break;
        depth--;
      }
      result += char;
    }
    return result.trim();
  };
  const fullCastTypeMatch = extractCastType(
    expressionWithoutAlias,
    /\bcast\s*\([\s\S]*?\s+as\s+([^\)]*(?:\([^\)]*\)[^\)]*)*)/i,
  );
  const fullShorthandTypeMatch = extractCastType(
    expressionWithoutAlias,
    /::\s*([a-z][\w]*(?:\s*\([^)]*\))?)/i,
  );

  const extractedType = (fullCastTypeMatch || fullShorthandTypeMatch)
    ? (fullCastTypeMatch || fullShorthandTypeMatch).replace(/\s+/g, " ").toLowerCase()
    : null;

  return {
    name,
    expression: expressionWithoutAlias.replace(/\s+/g, " ").toLowerCase(),
    type: extractedType,
  };
}

function extractColumns(sql) {
  return splitSelectList(extractSelectBody(sql))
    .map(columnFromExpression)
    .filter((column) => column.name && !column.name.startsWith("--"));
}

function extractJoinKeys(sql) {
  // Debug: log the SQL content being processed
  console.log(`SQL CONTENT FOR JOIN EXTRACTION: ${sql.substring(0, 300)}...`);
  
  // Simplified regex to capture join conditions
  // Match JOIN ... ON ... stopping at WHERE or end
  const joinPattern = /join\s+[\s\S]*?on\s+([^\n;]+?)(?=\s+where|\s+group|\s+order|\s+having|\s+union|\s*join|\n|$)/gi;
  const matches = [...sql.matchAll(joinPattern)]
    .map((match) => match[1].replace(/\s+/g, " ").trim().toLowerCase());
  
  // Debug: log what we're extracting
  console.log(`JOIN KEYS EXTRACTED: ${JSON.stringify(matches)}`);
  
  return matches;
}

function analyzeSchemaChange(baseSql, headSql) {
  const baseColumns = extractColumns(baseSql);
  const headColumns = extractColumns(headSql);
  const baseByName = new Map(baseColumns.map((column) => [column.name, column]));
  const headByName = new Map(headColumns.map((column) => [column.name, column]));
  const droppedColumns = baseColumns
    .filter((column) => !headByName.has(column.name))
    .map((column) => column.name);
  const addedColumns = headColumns
    .filter((column) => !baseByName.has(column.name))
    .map((column) => column.name);
  const renamedColumns = [];
  const remainingAdded = new Set(addedColumns);

  for (const oldName of droppedColumns) {
    const oldColumn = baseByName.get(oldName);
    const replacement = headColumns.find(
      (column) =>
        remainingAdded.has(column.name) &&
        column.expression === oldColumn.expression,
    );
    if (replacement) {
      renamedColumns.push({ from: oldName, to: replacement.name });
      remainingAdded.delete(replacement.name);
    }
  }

  const typeChanges = headColumns.flatMap((column) => {
    const previous = baseByName.get(column.name);
    if (!previous || previous.type === column.type || !previous.type || !column.type) {
      return [];
    }
    return [{ column: column.name, from: previous.type, to: column.type }];
  });

  const baseJoinKeys = new Set(extractJoinKeys(baseSql));
  const headJoinKeys = new Set(extractJoinKeys(headSql));
  const removedJoinKeys = [...baseJoinKeys].filter((key) => !headJoinKeys.has(key));
  const addedJoinKeys = [...headJoinKeys].filter((key) => !baseJoinKeys.has(key));

  return {
    droppedColumns: droppedColumns.filter(
      (name) => !renamedColumns.some((rename) => rename.from === name),
    ),
    addedColumns: addedColumns.filter((name) => remainingAdded.has(name)),
    renamedColumns,
    typeChanges,
    joinKeyChanges: { removed: removedJoinKeys, added: addedJoinKeys },
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
