#!/usr/bin/env bash
#
# test-pr-guardian-multi-key.sh
#
# Runs the full-suite tests in groups, switching GEMINI_API_KEY between
# groups so each group draws from an independent free-tier quota. Groups
# run strictly sequentially — never in parallel — because GEMINI_API_KEY
# is a single GitHub secret name; a job whose workflow run hasn't started
# yet will pick up whatever value the secret currently holds, so switching
# keys while a prior group's runs are still queued/in-progress can leak
# the wrong key into the wrong test.
#
# Requires: test-pr-guardian-full-suite.sh in the same directory, gh CLI.
#
# Edit GEMINI_KEY_1 through GEMINI_KEY_8 below, or export them before running.

set -eo pipefail

GEMINI_KEY_1="${GEMINI_KEY_1:-}"
GEMINI_KEY_2="${GEMINI_KEY_2:-}"
GEMINI_KEY_3="${GEMINI_KEY_3:-}"
GEMINI_KEY_4="${GEMINI_KEY_4:-}"
GEMINI_KEY_5="${GEMINI_KEY_5:-}"
GEMINI_KEY_6="${GEMINI_KEY_6:-}"
GEMINI_KEY_7="${GEMINI_KEY_7:-}"
GEMINI_KEY_8="${GEMINI_KEY_8:-}"

if [ -z "$GEMINI_KEY_1" ] || [ -z "$GEMINI_KEY_2" ] || [ -z "$GEMINI_KEY_3" ] || \
   [ -z "$GEMINI_KEY_4" ] || [ -z "$GEMINI_KEY_5" ] || [ -z "$GEMINI_KEY_6" ] || \
   [ -z "$GEMINI_KEY_7" ] || [ -z "$GEMINI_KEY_8" ]; then
  echo "Export GEMINI_KEY_1 through GEMINI_KEY_8 first, e.g.:" >&2
  echo "  export GEMINI_KEY_1=AIza..." >&2
  echo "  export GEMINI_KEY_2=AIza..." >&2
  echo "  ..." >&2
  echo "  export GEMINI_KEY_8=AIza..." >&2
  exit 1
fi

# Distribute scenarios across 8 keys (1 scenario per key to minimize quota usage)
# Each key only handles 1 scenario to avoid hitting free tier limits
GROUP_1_KEY="$GEMINI_KEY_1"
GROUP_1_SCENARIOS=(join-key-change)

GROUP_2_KEY="$GEMINI_KEY_2"
GROUP_2_SCENARIOS=(renamed-column)

GROUP_3_KEY="$GEMINI_KEY_3"
GROUP_3_SCENARIOS=(type-change)

GROUP_4_KEY="$GEMINI_KEY_4"
GROUP_4_SCENARIOS=(multi-model)

GROUP_5_KEY="$GEMINI_KEY_5"
GROUP_5_SCENARIOS=(comment-update)

GROUP_6_KEY="$GEMINI_KEY_6"
GROUP_6_SCENARIOS=(writeback)

GROUP_7_KEY="$GEMINI_KEY_7"
GROUP_7_SCENARIOS=(writeback-dedupe)

GROUP_8_KEY="$GEMINI_KEY_8"
GROUP_8_SCENARIOS=()  # Backup key

run_group() {
  local key="$1"
  shift
  local scenarios=("$@")

  echo "########################################"
  echo "## Switching GEMINI_API_KEY for this group"
  echo "########################################"
  gh secret set GEMINI_API_KEY --body "$key"

  # Give the secret write a moment to be visible to a freshly-queued run.
  sleep 5

  for scenario in "${scenarios[@]}"; do
    echo ""
    echo ">>> Running: $scenario"
    ./test-pr-guardian-full-suite.sh "$scenario"

    # Extra safety margin: leaves headroom under per-minute RPM limits
    echo ">>> Cooling down 30s before next scenario in this group..."
    sleep 30
  done
}

echo "== Group 1 (key 1): ${GROUP_1_SCENARIOS[*]}"
run_group "$GROUP_1_KEY" "${GROUP_1_SCENARIOS[@]}"

echo "== Group 2 (key 2): ${GROUP_2_SCENARIOS[*]}"
run_group "$GROUP_2_KEY" "${GROUP_2_SCENARIOS[@]}"

echo "== Group 3 (key 3): ${GROUP_3_SCENARIOS[*]}"
run_group "$GROUP_3_KEY" "${GROUP_3_SCENARIOS[@]}"

echo "== Group 4 (key 4): ${GROUP_4_SCENARIOS[*]}"
run_group "$GROUP_4_KEY" "${GROUP_4_SCENARIOS[@]}"

echo "== Group 5 (key 5): ${GROUP_5_SCENARIOS[*]}"
run_group "$GROUP_5_KEY" "${GROUP_5_SCENARIOS[@]}"

echo "== Group 6 (key 6): ${GROUP_6_SCENARIOS[*]}"
run_group "$GROUP_6_KEY" "${GROUP_6_SCENARIOS[@]}"

echo "== Group 7 (key 7): ${GROUP_7_SCENARIOS[*]}"
run_group "$GROUP_7_KEY" "${GROUP_7_SCENARIOS[@]}"

echo "== Group 8 (key 8): ${GROUP_8_SCENARIOS[*]} (backup - no scenarios)"
run_group "$GROUP_8_KEY" "${GROUP_8_SCENARIOS[@]}"

echo ""
echo "== All groups complete."
echo "== Review each PR's Actions run individually — this script doesn't"
echo "== aggregate pass/fail, it just sequences the key rotation safely."
echo "== gh pr list --state open --limit 20"
