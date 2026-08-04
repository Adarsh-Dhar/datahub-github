const { getDownstreamImpact } = require("../datahub/lineage");
const { summarizeRisk } = require("./riskSummary");
const { reviewWithAgent } = require("../agent/reviewAgent");

// Agent-based strategy: delegates investigation to the Gemini + DataHub MCP agent.
// Downstream impact is surfaced inside the agent's own tool calls, so we
// return an empty array here to avoid a redundant lineage query.
function agentRiskStrategy(config) {
  return {
    async evaluate(diff) {
      const agentResult = await reviewWithAgent(diff, config);
      return {
        assessment: { severity: agentResult.severity, summary: agentResult.summary },
        downstreamImpact: [],
      };
    },
    logStartupNotice() {},
  };
}

// Lineage + LLM-summary strategy: the non-agent fallback path.
// Fetches real downstream impact from DataHub (unless SKIP_DATAHUB is set),
// then summarises risk via the GitHub Models LLM or the local fallback heuristic.
function lineageRiskStrategy(config) {
  return {
    async evaluate(diff) {
      const downstreamImpact = config.skipDatahub
        ? []
        : await getDownstreamImpact(config, diff.modelName);
      return {
        assessment: await summarizeRisk(config, diff, downstreamImpact),
        downstreamImpact,
      };
    },
    logStartupNotice() {
      if (config.skipDatahub) {
        console.log("Skipping DataHub lineage calls (SKIP_DATAHUB=true).");
      }
    },
  };
}

// Single decision point for which risk-evaluation strategy to use.
// This is the only place in the codebase that branches on config.geminiApiKey.
function createRiskStrategy(config) {
  return config.geminiApiKey ? agentRiskStrategy(config) : lineageRiskStrategy(config);
}

module.exports = { createRiskStrategy };
