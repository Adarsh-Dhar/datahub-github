#!/usr/bin/env bash
#
# test-pr-guardian-multi-key.sh
#
# Runs the full-suite tests with automatic API key rotation on 429 quota errors.
# Each scenario tries with the current key, and if it hits a 429 error, it
# automatically rotates to the next available key and retries.
#
# Requires: test-pr-guardian-full-suite.sh in the same directory, gh CLI.

set -eo pipefail

# Array of all available API keys
API_KEYS=(
  "AIzaSyDlXLjDfFlqpFVgjg8LBLOvUxBgHjQkDJo"
  "AIzaSyBPaf1T4o8nS4k0NGKkDCvMKXRIiwSjU-I"
  "AIzaSyBXb33I_7mHnl-CrAt5QX3YKLOEJqP_tpE"
  "AIzaSyCmQeQDWqoJVZPxZPgFv8YOWwQAXLREb-o"
  "AIzaSyAmnAvh9oEhxjVN65kSp2dgzwLUFGESWV8"
  "AIzaSyAxgrX4feMF7etOuBAGqkvBysbob1tp_EI"
  "AIzaSyA6hm6bamK1di8LPoMytgBSKoz3lXFT6mc"
  "AIzaSyCrUTjG3yWFeIzzKPPah0W03xaCRYZHuFw"
)

# Test scenarios to run
SCENARIOS=(join-key-change renamed-column dropped-column multi-model comment-update writeback writeback-dedupe)

# Current key index
CURRENT_KEY_INDEX=0

# Function to set the current API key
set_api_key() {
  local key="$1"
  echo "########################################"
  echo "## Switching GEMINI_API_KEY"
  echo "########################################"
  gh secret set GEMINI_API_KEY --body "$key"
  sleep 5
}

# Function to rotate to next key
rotate_key() {
  CURRENT_KEY_INDEX=$((CURRENT_KEY_INDEX + 1))
  if [ $CURRENT_KEY_INDEX -ge ${#API_KEYS[@]} ]; then
    echo "ERROR: All API keys exhausted" >&2
    exit 1
  fi
  set_api_key "${API_KEYS[$CURRENT_KEY_INDEX]}"
}

# Function to run a single scenario with retry on 429
run_scenario_with_retry() {
  local scenario="$1"
  local max_retries=3
  local attempt=0
  
  while [ $attempt -lt $max_retries ]; do
    echo ""
    echo ">>> Running: $scenario (attempt $((attempt + 1))/$max_retries, key index $CURRENT_KEY_INDEX)"
    
    # Run the test
    if ./test-pr-guardian-full-suite.sh "$scenario"; then
      echo ">>> SUCCESS: $scenario completed"
      return 0
    fi
    
    # Check if it failed due to 429 quota error
    echo ">>> Checking for 429 quota error..."
    local run_id=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
    if [ -n "$run_id" ]; then
      local log_output=$(gh run view "$run_id" --log 2>/dev/null || echo "")
      if echo "$log_output" | grep -q "429"; then
        echo ">>> 429 quota error detected, rotating API key..."
        rotate_key
        attempt=$((attempt + 1))
        sleep 10
        continue
      fi
    fi
    
    # If not a 429 error, just fail
    echo ">>> FAILED: $scenario (non-quota error)"
    return 1
  done
  
  echo ">>> FAILED: $scenario (max retries exhausted)"
  return 1
}

# Set initial API key
set_api_key "${API_KEYS[$CURRENT_KEY_INDEX]}"

# Run all scenarios
for scenario in "${SCENARIOS[@]}"; do
  echo ""
  echo "========================================"
  echo "Scenario: $scenario"
  echo "========================================"
  
  if run_scenario_with_retry "$scenario"; then
    echo "✓ $scenario passed"
  else
    echo "✗ $scenario failed"
  fi
  
  # Cool down between scenarios
  echo ">>> Cooling down 30s before next scenario..."
  sleep 30
done

echo ""
echo "== All scenarios complete."
echo "== Review each PR's Actions run individually:"
echo "== gh pr list --state open --limit 20"
