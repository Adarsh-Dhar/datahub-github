#!/bin/bash

# Script to create test branches for PR Guardian feature testing

set -e

cd /Users/adarsh/Documents/datadog-github

# Ensure we're on main and up to date
git checkout main
git pull origin main

echo "=== Test 1: Renamed column detection ==="
git checkout -b test-renamed-column
cat > pr-guardian-demo/models/staging/stg_orders.sql << 'EOF'
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
git add pr-guardian-demo/models/staging/stg_orders.sql
git commit -m "test: rename order_total to total_amount"
git push -u origin test-renamed-column
echo "✓ test-renamed-column created and pushed"
git checkout main

echo "=== Test 2: Type/cast change detection ==="
git checkout -b test-type-change
cat > pr-guardian-demo/models/staging/stg_orders.sql << 'EOF'
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
git add pr-guardian-demo/models/staging/stg_orders.sql
git commit -m "test: change order_total cast from decimal(12,2) to decimal(10,2)"
git push -u origin test-type-change
echo "✓ test-type-change created and pushed"
git checkout main

echo "=== Test 3a: Join-key baseline (add join to fct_revenue) ==="
git checkout -b test-join-key-baseline
cat > pr-guardian-demo/models/marts/fct_revenue.sql << 'EOF'
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
git add pr-guardian-demo/models/marts/fct_revenue.sql
git commit -m "test: add join to fct_revenue (baseline)"
git push -u origin test-join-key-baseline
echo "✓ test-join-key-baseline created and pushed"
git checkout main

echo "=== Test 3b: Join-key change (modify join condition) ==="
git checkout -b test-join-key-change
cat > pr-guardian-demo/models/marts/fct_revenue.sql << 'EOF'
select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id and o.order_status = 'completed'
EOF
git add pr-guardian-demo/models/marts/fct_revenue.sql
git commit -m "test: change join condition in fct_revenue"
git push -u origin test-join-key-change
echo "✓ test-join-key-change created and pushed"
git checkout main

echo "=== Test 4: Safe/additive change (LOW risk) ==="
git checkout -b test-additive-change
cat > pr-guardian-demo/models/staging/stg_orders.sql << 'EOF'
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
git add pr-guardian-demo/models/staging/stg_orders.sql
git commit -m "test: add order_day column (additive change)"
git push -u origin test-additive-change
echo "✓ test-additive-change created and pushed"
git checkout main

echo "=== All test branches created successfully ==="
echo ""
echo "Next steps:"
echo "1. Merge test-join-key-baseline first (baseline for join-key tests)"
echo "2. Create PRs for each branch:"
echo "   - test-renamed-column"
echo "   - test-type-change"
echo "   - test-join-key-change (after baseline is merged)"
echo "   - test-additive-change"
echo ""
echo "3. For comment updating test, push additional commits to any existing PR"
echo "4. For AI summary test, set MODELS_TOKEN secret and re-run workflow"
echo "5. For writeback tests, merge a HIGH/MEDIUM risk PR and check DataHub"
