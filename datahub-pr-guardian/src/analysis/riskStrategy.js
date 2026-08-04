const { getDownstreamImpact } = require("../datahub/lineage");
const { summarizeRisk } = require("./riskSummary");
const { reviewWithAgent } = require("../agent/reviewAgent");
const { validateAgainstLiveSchema, checkContractViolations } = require("./schemaValidation");
const { getContractFields } = require("../datahub/contracts");
const { getDeprecationFlags } = require("../datahub/deprecation");
const { Severity } = require("../domain/severity");

function buildHardFailSummary(schemaProblems, contractViolations, deprecationFlags) {
  const parts = [];
  
  if (schemaProblems.length) {
    parts.push(`Schema validation issues: ${schemaProblems.join("; ")}`);
  }
  
  if (contractViolations.violations.length) {
    parts.push(`Data contract violations on: ${contractViolations.violations.join(", ")}`);
  }
  
  if (contractViolations.typeViolations.length) {
    parts.push(`Contract type violations on: ${contractViolations.typeViolations.map(v => v.column).join(", ")}`);
  }
  
  if (deprecationFlags.length) {
    parts.push(`Deprecation warnings: ${deprecationFlags.map(f => `${f.asset}${f.note ? ` (${f.note})` : ""}`).join(", ")}`);
  }
  
  return parts.length ? parts.join(" | ") : "Hard failure detected";
}

// Agent-based strategy: delegates investigation to the Gemini + DataHub MCP agent.
// Downstream impact is surfaced inside the agent's own tool calls, so we
// return an empty array here to avoid a redundant lineage query.
function agentRiskStrategy(config) {
  return {
    async evaluate(diff) {
      // Still run contract and deprecation checks in agent mode for hard failures
      const [contractFields, deprecationFlags] = await Promise.all([
        getContractFields(config, diff.modelName).catch(() => []),
        config.skipDatahub ? Promise.resolve([]) : getDownstreamImpact(config, diff.modelName)
          .then(impact => getDeprecationFlags(config, diff.modelName, impact))
          .catch(() => []),
      ]);

      const contractViolations = checkContractViolations(diff, contractFields);
      const forcedHigh = contractViolations.violations.length || deprecationFlags.length;

      let agentResult;
      if (forcedHigh) {
        agentResult = {
          severity: new Severity("high"),
          summary: buildHardFailSummary([], contractViolations, deprecationFlags),
        };
      } else {
        agentResult = await reviewWithAgent(diff, config);
      }

      return {
        assessment: { severity: agentResult.severity, summary: agentResult.summary },
        downstreamImpact: [],
        contractViolations,
        deprecationFlags,
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

      // Run validation checks in parallel
      const [schemaProblems, contractFields, deprecationFlags] = await Promise.all([
        diff.headSql ? validateAgainstLiveSchema(config, diff.headSql).catch(() => []) : Promise.resolve([]),
        getContractFields(config, diff.modelName).catch(() => []),
        getDeprecationFlags(config, diff.modelName, downstreamImpact).catch(() => []),
      ]);

      const contractViolations = checkContractViolations(diff, contractFields);

      // Force high severity for hard failures
      const forcedHigh = schemaProblems.length || 
                        contractViolations.violations.length || 
                        deprecationFlags.length;

      let assessment;
      if (forcedHigh) {
        assessment = {
          severity: "high",
          summary: buildHardFailSummary(schemaProblems, contractViolations, deprecationFlags),
        };
      } else {
        assessment = await summarizeRisk(config, diff, downstreamImpact);
      }

      return {
        assessment,
        downstreamImpact,
        schemaProblems,
        contractViolations,
        deprecationFlags,
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
