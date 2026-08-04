const LEVELS = ["low", "medium", "high"];
const EMOJI = { low: "🟢", medium: "🟡", high: "🔴" };
const DEFAULT_LEVEL = "medium";

// A validated, self-rendering severity level.
// Replaces bare "low"/"medium"/"high" strings that were previously validated
// independently in riskSummary.js, commentRenderer.js, and reviewAgent.js.
class Severity {
  constructor(level) {
    this.level = LEVELS.includes(level) ? level : DEFAULT_LEVEL;
  }

  // Parse a severity from free text (e.g. an LLM response).
  // Returns a Severity at the default level when no match is found.
  static fromText(text) {
    const match = String(text || "").match(/low|medium|high/i);
    return new Severity(match ? match[0].toLowerCase() : DEFAULT_LEVEL);
  }

  get emoji() {
    return EMOJI[this.level];
  }

  // Upper-cased label suitable for comment headers.
  get label() {
    return this.level.toUpperCase();
  }

  toString() {
    return this.level;
  }
}

module.exports = { Severity, LEVELS };
