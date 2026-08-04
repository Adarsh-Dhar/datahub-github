const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function connectDatahubMcp(config) {
  const transport = new StdioClientTransport({
    command: "uvx",
    args: ["mcp-server-datahub@latest"],
    env: {
      ...process.env,
      DATAHUB_GMS_URL: config.datahubGmsUrl,
      DATAHUB_GMS_TOKEN: config.datahubToken,
      TOOLS_IS_MUTATION_ENABLED: config.allowMutations ? "true" : "false",
    },
  });

  const client = new Client({ name: "pr-guardian-agent", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const { tools } = await client.listTools();
  return { client, tools };
}

module.exports = { connectDatahubMcp };
