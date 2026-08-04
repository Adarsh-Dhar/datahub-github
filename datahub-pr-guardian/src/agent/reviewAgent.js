const { GoogleGenAI } = require("@google/genai");
const { connectDatahubMcp } = require("./mcpClient");

async function reviewWithAgent(diff, config) {
  const { client, tools } = await connectDatahubMcp(config);

  const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: stripUnsupportedSchemaFields(t.inputSchema),
  }));

  const systemPrompt = `You are reviewing a dbt model change for breaking-change risk.
Use the DataHub tools available to you to investigate real downstream impact —
call get_lineage to see what depends on this model, and get_dataset_queries to see
if the affected columns are actually used in real queries. Do not guess; call the
tools. When you are done investigating, respond with a JSON object:
{ "severity": "low"|"medium"|"high", "summary": "3-4 sentence explanation" }`;

  const userPrompt = `Model: ${diff.modelName}
Dropped columns: ${JSON.stringify(diff.droppedColumns)}
Renamed columns: ${JSON.stringify(diff.renamedColumns)}
Type changes: ${JSON.stringify(diff.typeChanges)}
Join-key changes: ${JSON.stringify(diff.joinKeyChanges)}`;

  let contents = [{ role: "user", parts: [{ text: userPrompt }] }];
  let finalResult = null;

  for (let turn = 0; turn < 8 && !finalResult; turn++) {
    const response = await genai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations }],
      },
    });

    const parts = response.candidates[0].content.parts;
    contents.push({ role: "model", parts });

    const functionCalls = parts.filter((p) => p.functionCall);
    if (functionCalls.length === 0) {
      const text = parts.find((p) => p.text)?.text || "";
      finalResult = parseAgentResult(text);
      break;
    }

    const responseParts = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall;
      if (client) {
        const result = await client.callTool({ name, arguments: args });
        responseParts.push({
          functionResponse: { name, response: { content: result.content } },
        });
      }
    }
    contents.push({ role: "user", parts: responseParts });
  }

  if (client) await client.close();
  return finalResult || { severity: "medium", summary: "Agent did not converge on a result; review manually." };
}

function stripUnsupportedSchemaFields(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const { additionalProperties, $schema, ...rest } = schema;
  if (rest.properties) {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([k, v]) => [k, stripUnsupportedSchemaFields(v)]),
    );
  }
  return rest;
}

function parseAgentResult(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

module.exports = { reviewWithAgent };
