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
