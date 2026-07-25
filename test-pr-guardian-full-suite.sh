#!/usr/bin/env bash
#
# test-pr-guardian-full-suite.sh
#
# Covers the functionality NOT exercised by test-pr-guardian-e2e.sh:
# dropped columns, renamed columns, join-key changes (fixed, no baseline
# needed), a brand-new model, a multi-model PR, the comment-update-in-place
# path, the LLM risk-summary path, writeback + writeback dedupe, the
# DataHub-unreachable failure mode, and a manual workflow_dispatch run.
#
# Requires: git, gh (authenticated), jq is used implicitly via gh --jq.
#
# Usage:
#   ./test-pr-guardian-full-suite.sh <test> [args...]
#
# Tests:
#   dropped-column
#   renamed-column
#   join-key-change
#   new-model
#   multi-model
#   comment-update
#   llm-check                       (needs: export LLM_TEST_TOKEN=...)
#   writeback
#   writeback-dedupe
#   datahub-down <bad-url> <restore-url>
#   dispatch <base_sha> <head_sha> <pr_number>
#   all                             (runs every test that needs no extra args)

set -eo pipefail

TEST="${1:-}"
shift || true

if [ -z "$TEST" ]; then
  echo "Usage: $0 <test> [args...]" >&2
  echo "Tests: dropped-column | renamed-column | join-key-change | new-model |" >&2
  echo "       multi-model | comment-update | llm-check | writeback |" >&2
  echo "       writeback-dedupe | datahub-down <bad-url> <restore-url> |" >&2
  echo "       dispatch <base_sha> <head_sha> <pr_number> | all" >&2
  exit 1
fi

command -v git >/dev/null 2>&1 || { echo "Missing git" >&2; exit 1; }
command -v gh  >/dev/null 2>&1 || { echo "Missing gh"  >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
DEFAULT_BRANCH="$(git remote show origin | awk '/HEAD branch/ {print $NF}')"

STAGING_FILE="pr-guardian-demo/models/staging/stg_orders.sql"
MARTS_FILE="pr-guardian-demo/models/marts/fct_revenue.sql"
NEW_MODEL_FILE="pr-guardian-demo/models/marts/order_summary.sql"

ORIGINAL_STAGING="$(cat <<'EOF'
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(12, 2)) as order_total,
    created_at
from source_orders
EOF
)"

ORIGINAL_MARTS="$(cat <<'EOF'
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at,
    date_trunc('day', o.created_at) as order_date
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id and o.order_status = 'completed'
EOF
)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
fresh_branch() {
  local name="$1"
  git checkout "$DEFAULT_BRANCH"
  git pull origin "$DEFAULT_BRANCH"
  git checkout -b "$name"
}

commit_push() {
  local msg="$1"
  git add -A
  git commit -m "$msg"
  git push -u origin "$(git branch --show-current)"
}

open_pr() {
  local title="$1"
  local body="$2"
  local branch
  branch="$(git branch --show-current)"
  local url
  url="$(gh pr create --base "$DEFAULT_BRANCH" --head "$branch" --title "$title" --body "$body")"
  basename "$url"
}

wait_for_run() {
  local workflow="$1"
  local head_sha="$2"
  local run_id=""
  for _ in $(seq 1 30); do
    run_id="$(gh run list --workflow "$workflow" --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$head_sha\") | .databaseId" | head -n1 || true)"
    [ -n "$run_id" ] && break
    sleep 5
  done
  echo "$run_id"
}

watch_and_report() {
  local run_id="$1"
  if [ -z "$run_id" ]; then
    echo "!! No matching run found within timeout." >&2
    return 1
  fi
  echo "== Watching run $run_id"
  gh run watch "$run_id" --exit-status || echo "!! Run finished non-zero."
}

guardian_comment() {
  local pr_number="$1"
  gh pr view "$pr_number" --json comments \
    --jq '.comments[] | select(.body | contains("DataHub PR Guardian")) | .body'
}

guardian_comment_meta() {
  # prints "<id> <updatedAt>" for the guardian comment, one per line
  local pr_number="$1"
  gh pr view "$pr_number" --json comments \
    --jq '.comments[] | select(.body | contains("DataHub PR Guardian")) | (.id + " " + .updatedAt)'
}

run_and_report() {
  # opens PR for the current branch, waits for analyze run, prints comment
  local title="$1"
  local body="$2"
  local head_sha
  head_sha="$(git rev-parse HEAD)"
  local pr_number
  pr_number="$(open_pr "$title" "$body")"
  echo "== Opened PR #$pr_number"
  local run_id
  run_id="$(wait_for_run "pr-guardian.yml" "$head_sha")"
  watch_and_report "$run_id"
  echo "== Guardian comment on PR #$pr_number:"
  guardian_comment "$pr_number"
  echo "$pr_number"
}

# ---------------------------------------------------------------------------
# Individual tests
# ---------------------------------------------------------------------------

test_dropped_column() {
  echo "### TEST: dropped-column"
  fresh_branch "test-dropped-column-$(date +%s)"
  cat <<'EOF' > "$MARTS_FILE"
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id and o.order_status = 'completed'
EOF
  commit_push "test: drop order_date column from fct_revenue"
  run_and_report "Test: dropped column detection" \
    "Automated test. Drops order_date with no matching rename. Expect a dropped-columns entry."
  git checkout "$DEFAULT_BRANCH"
}

test_renamed_column() {
  echo "### TEST: renamed-column"
  fresh_branch "test-renamed-column-$(date +%s)"
  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(12, 2)) as total_amount,
    created_at
from source_orders
EOF
  commit_push "test: rename order_total to total_amount"
  run_and_report "Test: renamed column detection" \
    "Automated test. Expect a renamed-column entry (order_total -> total_amount)."
  git checkout "$DEFAULT_BRANCH"
}

test_join_key_change() {
  echo "### TEST: join-key-change"
  fresh_branch "test-join-key-change-$(date +%s)"
  cat <<'EOF' > "$MARTS_FILE"
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at,
    date_trunc('day', o.created_at) as order_date
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id and o.order_status = 'shipped'
EOF
  commit_push "test: change join condition literal in fct_revenue"
  run_and_report "Test: join-key change detection" \
    "Automated test. Changes the join ON clause only (no columns dropped/renamed). Expect a join-key-change entry."
  git checkout "$DEFAULT_BRANCH"
}

test_new_model() {
  echo "### TEST: new-model (diff.isNew skip path)"
  fresh_branch "test-new-model-$(date +%s)"
  cat > "$NEW_MODEL_FILE" <<'EOF'
select
    o.order_status,
    count(*) as order_count,
    sum(o.order_total) as total_revenue
from {{ ref('stg_orders') }} o
group by o.order_status
EOF
  commit_push "test: add brand-new order_summary model"
  echo "-- This model has no base-branch version, so diff.isNew should be true"
  echo "-- and index.js should skip it (no section, no crash)."
  run_and_report "Test: brand-new model (no base version)" \
    "Automated test. New model, no prior version. Expect this model to be silently skipped, not crash the run."
  git checkout "$DEFAULT_BRANCH"
  rm -f "$NEW_MODEL_FILE"
}

test_multi_model() {
  echo "### TEST: multi-model PR (two models changed in one PR)"
  fresh_branch "test-multi-model-$(date +%s)"
  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(10, 2)) as order_total,
    created_at
from source_orders
EOF
  cat <<'EOF' > "$MARTS_FILE"
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id and o.order_status = 'completed'
EOF
  commit_push "test: change stg_orders type AND drop fct_revenue.order_date in one PR"
  echo "-- Expect TWO sections in the comment: stg_orders (type change) and fct_revenue (dropped column)."
  run_and_report "Test: multi-model PR" \
    "Automated test. Changes two models in one PR. Expect two separate sections in the comment."
  git checkout "$DEFAULT_BRANCH"
}

test_comment_update() {
  echo "### TEST: comment update-in-place (not a duplicate post)"
  local branch="test-comment-update-$(date +%s)"
  fresh_branch "$branch"

  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(12, 2)) as total_amount,
    created_at
from source_orders
EOF
  commit_push "test: first commit - rename order_total"

  local head_sha pr_number run_id
  head_sha="$(git rev-parse HEAD)"
  pr_number="$(open_pr "Test: comment update in place" \
    "Automated test. Pushing a second commit shortly to confirm the same comment is edited, not duplicated.")"
  echo "== Opened PR #$pr_number"
  run_id="$(wait_for_run "pr-guardian.yml" "$head_sha")"
  watch_and_report "$run_id"

  echo "== Comment state after commit 1:"
  local before
  before="$(guardian_comment_meta "$pr_number")"
  echo "$before"
  local before_count
  before_count="$(echo "$before" | grep -c . || true)"

  echo "== Pushing a second commit (type change on top of the rename)..."
  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(10, 2)) as total_amount,
    created_at
from source_orders
EOF
  git add -A
  git commit -m "test: second commit - also change the type"
  git push

  head_sha="$(git rev-parse HEAD)"
  run_id="$(wait_for_run "pr-guardian.yml" "$head_sha")"
  watch_and_report "$run_id"

  echo "== Comment state after commit 2:"
  local after
  after="$(guardian_comment_meta "$pr_number")"
  echo "$after"
  local after_count
  after_count="$(echo "$after" | grep -c . || true)"

  echo "== RESULT:"
  echo "   Guardian comments before: $before_count"
  echo "   Guardian comments after:  $after_count"
  if [ "$before_count" = "1" ] && [ "$after_count" = "1" ]; then
    echo "   PASS: exactly one guardian comment both times (edited in place)."
  else
    echo "   FAIL or ambiguous: expected exactly 1 comment at both checkpoints. Inspect PR #$pr_number manually."
  fi

  git checkout "$DEFAULT_BRANCH"
}

test_llm_check() {
  echo "### TEST: LLM risk-summary path"
  if [ -z "${LLM_TEST_TOKEN:-}" ]; then
    echo "!! Set LLM_TEST_TOKEN to the same value as the MODELS_TOKEN secret first:" >&2
    echo "     export LLM_TEST_TOKEN=github_pat_xxx" >&2
    return 1
  fi
  echo "== Direct call to GitHub Models API:"
  curl -s https://models.github.ai/inference/chat/completions \
    -H "Authorization: Bearer $LLM_TEST_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Reply with exactly: PR Guardian LLM check OK"}]}'
  echo
  echo "-- If you saw a choices[0].message.content above, the token/scope work."
  echo "-- Now run a real scenario and read the PR comment prose: LLM output reads as"
  echo "-- free-form 3-4 sentences; fallbackRisk() output is a fixed template sentence."
  echo "-- (run: ./test-pr-guardian-full-suite.sh renamed-column, or the e2e script)"
}

test_writeback() {
  echo "### TEST: writeback (merge -> DataHub description updated)"
  fresh_branch "test-writeback-$(date +%s)"
  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(12, 2)) as total_amount,
    created_at
from source_orders
EOF
  commit_push "test: rename column for writeback test"

  local pr_number head_sha run_id
  head_sha="$(git rev-parse HEAD)"
  pr_number="$(open_pr "Test: writeback" "Automated test. Will be merged to trigger the writeback workflow.")"
  echo "== Opened PR #$pr_number"
  run_id="$(wait_for_run "pr-guardian.yml" "$head_sha")"
  watch_and_report "$run_id"
  guardian_comment "$pr_number"

  echo "== Merging PR #$pr_number"
  gh pr merge "$pr_number" --squash --delete-branch

  local merge_sha wb_run_id
  merge_sha="$(gh pr view "$pr_number" --json mergeCommit --jq '.mergeCommit.oid')"
  wb_run_id="$(wait_for_run "writeback.yml" "$merge_sha")"
  watch_and_report "$wb_run_id"

  if [ -n "$wb_run_id" ]; then
    echo "== Writeback log:"
    gh run view "$wb_run_id" --log | grep -i "DataHub review note" || \
      echo "   (no matching log line — check the run manually)"
  fi

  echo "== Now confirm independently via DataHub GraphQL (fill in your GMS URL/token):"
  echo '  curl -s -X POST "$DATAHUB_GMS_URL/api/graphql" \'
  echo '    -H "Content-Type: application/json" -H "Authorization: Bearer $DATAHUB_TOKEN" \'
  echo '    -d '"'"'{"query":"query { dataset(urn: \"urn:li:dataset:(urn:li:dataPlatform:duckdb,pr_guardian_demo.main.stg_orders,PROD)\") { editableProperties { description } } }"}'"'"
  echo "== Look for: [PR Guardian] Reviewed in PR #$pr_number"

  git checkout "$DEFAULT_BRANCH"
}

test_writeback_dedupe() {
  echo "### TEST: writeback dedupe (second merge on same model doesn't duplicate the note)"
  echo "-- Run this AFTER test_writeback has already merged one PR touching stg_orders."
  fresh_branch "test-writeback-dedupe-$(date +%s)"
  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(10, 2)) as order_total,
    created_at
from source_orders
EOF
  commit_push "test: second change to stg_orders for dedupe test"

  local pr_number head_sha run_id
  head_sha="$(git rev-parse HEAD)"
  pr_number="$(open_pr "Test: writeback dedupe" "Automated test. A second merge touching stg_orders.")"
  run_id="$(wait_for_run "pr-guardian.yml" "$head_sha")"
  watch_and_report "$run_id"
  guardian_comment "$pr_number"

  gh pr merge "$pr_number" --squash --delete-branch

  local merge_sha wb_run_id
  merge_sha="$(gh pr view "$pr_number" --json mergeCommit --jq '.mergeCommit.oid')"
  wb_run_id="$(wait_for_run "writeback.yml" "$merge_sha")"
  watch_and_report "$wb_run_id"

  if [ -n "$wb_run_id" ]; then
    echo "== Writeback log (look for 'skipped' if it correctly detected a duplicate note, or a second appended note if not a dup):"
    gh run view "$wb_run_id" --log | grep -i "DataHub review note\|skipped" || \
      echo "   (no matching log line — check the run manually)"
  fi
  echo "== Confirm via the same GraphQL query as test_writeback: description should have"
  echo "== ONE new line for PR #$pr_number, not a second copy of the earlier PR's note."

  git checkout "$DEFAULT_BRANCH"
}

test_datahub_down() {
  local bad_url="$1"
  local restore_url="$2"
  if [ -z "$bad_url" ] || [ -z "$restore_url" ]; then
    echo "Usage: $0 datahub-down <bad-url> <restore-url>" >&2
    exit 1
  fi
  echo "### TEST: DataHub unreachable -> Action should FAIL LOUDLY, not silently report 0 assets"
  echo "== Pointing DATAHUB_GMS_URL at an unreachable address..."
  gh secret set DATAHUB_GMS_URL --body "$bad_url"

  fresh_branch "test-datahub-down-$(date +%s)"
  cat <<'EOF' > "$STAGING_FILE"
with source_orders as (
    select
        order_id,
        customer_id,
        order_status,
        order_total,
        created_at
    from {{ source('raw', 'orders') }}
)

select
    order_id,
    customer_id,
    order_status,
    cast(order_total as decimal(12, 2)) as total_amount,
    created_at
from source_orders
EOF
  commit_push "test: DataHub-down failure mode"

  local pr_number head_sha run_id
  head_sha="$(git rev-parse HEAD)"
  pr_number="$(open_pr "Test: DataHub unreachable" "Automated test. DATAHUB_GMS_URL is intentionally broken for this run.")"
  run_id="$(wait_for_run "pr-guardian.yml" "$head_sha")"

  echo "== Restoring DATAHUB_GMS_URL immediately (don't leave it broken)..."
  gh secret set DATAHUB_GMS_URL --body "$restore_url"

  echo "== Run result (expect a FAILURE / red X, not success):"
  gh run view "$run_id" --json conclusion --jq '.conclusion'
  gh run view "$run_id" --log | grep -iE "datahub.*fail|error" | head -5 || true

  echo "== Also check: did it still post a false '0 downstream assets' comment despite failing?"
  guardian_comment "$pr_number" || echo "(no comment — also acceptable, means it failed before commenting)"

  git checkout "$DEFAULT_BRANCH"
}

test_dispatch() {
  local base_sha="$1"
  local head_sha="$2"
  local pr_number="$3"
  if [ -z "$base_sha" ] || [ -z "$head_sha" ] || [ -z "$pr_number" ]; then
    echo "Usage: $0 dispatch <base_sha> <head_sha> <pr_number>" >&2
    echo "Tip: use the base/head SHAs and number from any existing test PR." >&2
    exit 1
  fi
  echo "### TEST: manual workflow_dispatch trigger"
  gh workflow run pr-guardian.yml \
    -f base_sha="$base_sha" \
    -f head_sha="$head_sha" \
    -f pr_number="$pr_number"
  echo "== Triggered. Waiting a moment, then listing recent runs:"
  sleep 8
  gh run list --workflow pr-guardian.yml --limit 3
  echo "== Watch it with: gh run watch <run-id> --exit-status"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$TEST" in
  dropped-column)    test_dropped_column ;;
  renamed-column)     test_renamed_column ;;
  join-key-change)    test_join_key_change ;;
  new-model)          test_new_model ;;
  multi-model)        test_multi_model ;;
  comment-update)      test_comment_update ;;
  llm-check)           test_llm_check ;;
  writeback)            test_writeback ;;
  writeback-dedupe)     test_writeback_dedupe ;;
  datahub-down)         test_datahub_down "$@" ;;
  dispatch)             test_dispatch "$@" ;;
  all)
    test_dropped_column
    test_renamed_column
    test_join_key_change
    test_new_model
    test_multi_model
    test_comment_update
    test_writeback
    test_writeback_dedupe
    echo "Skipped: llm-check (needs LLM_TEST_TOKEN), datahub-down (needs bad/restore URLs), dispatch (needs SHAs)."
    echo "Run those three individually when you have the extra inputs."
    ;;
  *)
    echo "Unknown test: $TEST" >&2
    exit 1
    ;;
esac