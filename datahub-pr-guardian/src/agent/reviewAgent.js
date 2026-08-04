const { GoogleGenAI } = require("@google/genai");
const { connectDatahubMcp } = require("./mcpClient");

const MAX_AGENT_TURNS = 8;
const GEMINI_MODEL = "gemini-2.0-flash";
const AGENT_FALLBACK = {
  severity: "medium",
  summary: "Agent did not converge on a result; review manually.",
};

const REVIEW_SYSTEM_PROMPT = `You are reviewing a dbt model change for breaking-change risk.
Use the DataHub tools available to you to investigate real downstream impact —
call get_lineage to see what depends on this model, and get_dataset_queries to see
if the affected columns are actually used in real queries. Also validate that any
referenced upstream columns actually exist by checking the source table schemas.
Do not guess; call the tools. When you are done investigating, respond with a JSON object:
{ "severity": "low"|"medium"|"high", "summary": "3-4 sentence explanation" }`;

// Removes schema fields that the Gemini function-calling API does not accept.
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const { additionalProperties, $schema, ...rest } = schema;
  if (rest.properties) {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  return rest;
}

function buildReviewPrompt(diff) {
  const parts = [`Model: ${diff.modelName}`];
  
  // Handle DAG-specific changes
  if (diff.removedTables) {
    parts.push(`Removed tables: ${JSON.stringify(diff.removedTables)}`);
  }
  if (diff.addedTables) {
    parts.push(`Added tables: ${JSON.stringify(diff.addedTables)}`);
  }
  
  // Handle SQL-specific changes
  if (diff.droppedColumns) {
    parts.push(`Dropped columns: ${JSON.stringify(diff.droppedColumns)}`);
  }
  if (diff.renamedColumns) {
    parts.push(`Renamed columns: ${JSON.stringify(diff.renamedColumns)}`);
  }
  if (diff.typeChanges) {
    parts.push(`Type changes: ${JSON.stringify(diff.typeChanges)}`);
  }
  if (diff.joinKeyChanges) {
    parts.push(`Join-key changes: ${JSON.stringify(diff.joinKeyChanges)}`);
  }
  
  return parts.join("\n");
}

function parseAgentResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

async function dispatchToolCalls(client, functionCalls) {
  const responseParts = [];
  for (const part of functionCalls) {
    const { name, args } = part.functionCall;
    const toolResult = await client.callTool({ name, arguments: args });
    responseParts.push({
      functionResponse: { name, response: { content: toolResult.content } },
    });
  }
  return responseParts;
}

async function reviewWithAgent(diff, config) {
  const { client, tools } = await connectDatahubMcp(config);
  const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const functionDeclarations = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.inputSchema),
  }));

  const contents = [{ role: "user", parts: [{ text: buildReviewPrompt(diff) }] }];
  let finalResult = null;

  for (let turn = 0; turn < MAX_AGENT_TURNS && !finalResult; turn++) {
    const response = await genai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: REVIEW_SYSTEM_PROMPT,
        tools: [{ functionDeclarations }],
      },
    });

    const parts = response.candidates[0].content.parts;
    contents.push({ role: "model", parts });

    const functionCalls = parts.filter((part) => part.functionCall);
    if (functionCalls.length === 0) {
      const text = parts.find((part) => part.text)?.text || "";
      finalResult = parseAgentResult(text);
      break;
    }

    const responseParts = await dispatchToolCalls(client, functionCalls);
    contents.push({ role: "user", parts: responseParts });
  }

  await client.close();
  return finalResult || AGENT_FALLBACK;
}

module.exports = { reviewWithAgent, buildReviewPrompt, parseAgentResult };
