#!/usr/bin/env bash
#
# test-pr-guardian-e2e.sh
#
# End-to-end test for DataHub PR Guardian: edits a dbt model, creates a
# branch, pushes it, opens a real PR, watches the "analyze" GitHub Action
# run to completion, and prints the guardian's PR comment. Optionally
# merges the PR and watches the "writeback" workflow too.
#
# Requires: git, GitHub CLI (gh) authenticated (`gh auth login`), and a
# repo that already has datahub-pr-guardian wired into
# .github/workflows/pr-guardian.yml and writeback.yml.
#
# Usage:
#   ./test-pr-guardian-e2e.sh <scenario> [--merge] [--repo owner/name]
#
# Scenarios:
#   renamed-column       stg_orders: order_total -> total_amount (same expr)
#   type-change           stg_orders: order_total decimal(12,2) -> decimal(10,2)
#   join-key-baseline     fct_revenue: add a join to dim_customers (run once, merge before join-key-change)
#   join-key-change       fct_revenue: modify the join condition
#   additive-change        stg_orders: add order_day column
#   custom <file> <heredoc-file>   overwrite <file> with contents of <heredoc-file>

set -euo pipefail

SCENARIO="${1:-}"
shift || true

DO_MERGE=false
REPO_OVERRIDE=""
CUSTOM_FILE=""
CUSTOM_CONTENT_FILE=""

if [ "$SCENARIO" = "custom" ]; then
  CUSTOM_FILE="${1:-}"
  CUSTOM_CONTENT_FILE="${2:-}"
  shift 2 || true
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --merge) DO_MERGE=true; shift ;;
    --repo) REPO_OVERRIDE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$SCENARIO" ]; then
  echo "Usage: $0 <scenario> [--merge] [--repo owner/name]" >&2
  echo "Scenarios: renamed-column | type-change | join-key-baseline | join-key-change | additive-change | custom <file> <content-file>" >&2
  exit 1
fi

for bin in git gh; do
  command -v "$bin" >/dev/null 2>&1 || { echo "Missing required tool: $bin" >&2; exit 1; }
done

gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

if [ -n "$REPO_OVERRIDE" ]; then
  GH_REPO_FLAG=(--repo "$REPO_OVERRIDE")
else
  GH_REPO_FLAG=()
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

DEFAULT_BRANCH="$(git remote show origin | awk '/HEAD branch/ {print $NF}')"
STAMP="$(date +%s)"
BRANCH="test-${SCENARIO}-${STAMP}"

STAGING_FILE="pr-guardian-demo/models/staging/stg_orders.sql"
MARTS_FILE="pr-guardian-demo/models/marts/fct_revenue.sql"

echo "== Repo root: $REPO_ROOT"
echo "== Default branch: $DEFAULT_BRANCH"
echo "== Scenario: $SCENARIO"
echo "== Branch to create: $BRANCH"

git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"
git checkout -b "$BRANCH"

COMMIT_MSG=""
PR_TITLE=""
PR_BODY=""

apply_edit() {
  local target_file="$1"
  local content="$2"
  printf '%s' "$content" > "$target_file"
}

case "$SCENARIO" in
  renamed-column)
    apply_edit "$STAGING_FILE" "$(cat <<'EOF'
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
)"
    COMMIT_MSG="test: rename order_total to total_amount"
    PR_TITLE="Test: renamed column detection"
    PR_BODY="Automated PR Guardian test. Expect a renamed-column entry (order_total -> total_amount)."
    ;;

  type-change)
    apply_edit "$STAGING_FILE" "$(cat <<'EOF'
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
)"
    COMMIT_MSG="test: change order_total cast from decimal(12,2) to decimal(10,2)"
    PR_TITLE="Test: type change detection"
    PR_BODY="Automated PR Guardian test. Expect a type-change entry for order_total."
    ;;

  join-key-baseline)
    apply_edit "$MARTS_FILE" "$(cat <<'EOF'
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id
where o.order_status = 'completed'
EOF
)"
    COMMIT_MSG="test: add join to fct_revenue (baseline)"
    PR_TITLE="Test: join-key baseline"
    PR_BODY="Automated PR Guardian test. Baseline for a follow-up join-key-change test. Merge this before running join-key-change."
    ;;

  join-key-change)
    apply_edit "$MARTS_FILE" "$(cat <<'EOF'
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id and o.order_status = 'completed'
EOF
)"
    COMMIT_MSG="test: change join condition in fct_revenue"
    PR_TITLE="Test: join-key change detection"
    PR_BODY="Automated PR Guardian test. Expect a join-key-change entry. Requires join-key-baseline already merged."
    ;;

  additive-change)
    apply_edit "$STAGING_FILE" "$(cat <<'EOF'
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
    created_at,
    date_trunc('day', created_at) as order_day
from source_orders
EOF
)"
    COMMIT_MSG="test: add order_day column (additive change)"
    PR_TITLE="Test: additive change"
    PR_BODY="Automated PR Guardian test. Additive-only change; expect a skip with debug info (no downstream/DataHub call)."
    ;;

  custom)
    [ -n "$CUSTOM_FILE" ] && [ -n "$CUSTOM_CONTENT_FILE" ] || {
      echo "custom scenario needs: custom <target-file> <content-file>" >&2
      exit 1
    }
    [ -f "$CUSTOM_CONTENT_FILE" ] || { echo "Content file not found: $CUSTOM_CONTENT_FILE" >&2; exit 1; }
    cp "$CUSTOM_CONTENT_FILE" "$CUSTOM_FILE"
    COMMIT_MSG="test: custom edit to $CUSTOM_FILE"
    PR_TITLE="Test: custom schema change ($CUSTOM_FILE)"
    PR_BODY="Automated PR Guardian test with a custom edit to $CUSTOM_FILE."
    ;;

  *)
    echo "Unknown scenario: $SCENARIO" >&2
    exit 1
    ;;
esac

git add -A
git commit -m "$COMMIT_MSG"
git push -u origin "$BRANCH"

PR_URL="$(gh pr create "${GH_REPO_FLAG[@]}" \
  --base "$DEFAULT_BRANCH" \
  --head "$BRANCH" \
  --title "$PR_TITLE" \
  --body "$PR_BODY")"
PR_NUMBER="$(basename "$PR_URL")"
echo "== Opened PR #$PR_NUMBER: $PR_URL"

echo "== Waiting for the analyze workflow to start..."
HEAD_SHA="$(git rev-parse HEAD)"

RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list "${GH_REPO_FLAG[@]}" \
    --workflow "pr-guardian.yml" \
    --json databaseId,headSha \
    --jq ".[] | select(.headSha == \"$HEAD_SHA\") | .databaseId" | head -n1 || true)"
  [ -n "$RUN_ID" ] && break
  sleep 5
done

if [ -z "$RUN_ID" ]; then
  echo "!! Could not find a matching workflow run within the timeout." >&2
  echo "   Check manually: gh run list ${GH_REPO_FLAG[*]} --workflow pr-guardian.yml"
else
  echo "== Watching run $RUN_ID"
  gh run watch "$RUN_ID" "${GH_REPO_FLAG[@]}" --exit-status || \
    echo "!! Analyze workflow run finished with a non-zero exit status."
fi

echo "== Guardian comment on PR #$PR_NUMBER:"
gh pr view "$PR_NUMBER" "${GH_REPO_FLAG[@]}" --json comments \
  --jq '.comments[] | select(.body | contains("DataHub PR Guardian")) | .body' || \
  echo "!! No guardian comment found yet — the run may still be posting it."

if [ "$DO_MERGE" = true ]; then
  echo "== Merging PR #$PR_NUMBER"
  gh pr merge "$PR_NUMBER" "${GH_REPO_FLAG[@]}" --squash --delete-branch

  echo "== Waiting for the writeback workflow to start..."
  MERGE_SHA="$(gh pr view "$PR_NUMBER" "${GH_REPO_FLAG[@]}" --json mergeCommit --jq '.mergeCommit.oid')"

  WB_RUN_ID=""
  for _ in $(seq 1 30); do
    WB_RUN_ID="$(gh run list "${GH_REPO_FLAG[@]}" \
      --workflow "writeback.yml" \
      --json databaseId,headSha \
      --jq ".[] | select(.headSha == \"$MERGE_SHA\") | .databaseId" | head -n1 || true)"
    [ -n "$WB_RUN_ID" ] && break
    sleep 5
  done

  if [ -z "$WB_RUN_ID" ]; then
    echo "!! Could not find a matching writeback run within the timeout." >&2
    echo "   Check manually: gh run list ${GH_REPO_FLAG[*]} --workflow writeback.yml"
  else
    echo "== Watching writeback run $WB_RUN_ID"
    gh run watch "$WB_RUN_ID" "${GH_REPO_FLAG[@]}" --exit-status || \
      echo "!! Writeback workflow run finished with a non-zero exit status."
    echo "== Writeback log:"
    gh run view "$WB_RUN_ID" "${GH_REPO_FLAG[@]}" --log | grep -i "DataHub review note" || \
      echo "   (no matching log line found — check the run manually)"
  fi
else
  echo "== Skipping merge/writeback (pass --merge to also test the writeback workflow)"
fi

git checkout "$DEFAULT_BRANCH"
echo "== Done."
