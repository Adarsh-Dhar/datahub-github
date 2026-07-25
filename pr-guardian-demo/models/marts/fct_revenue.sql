select
    o.order_id,
    o.customer_id,
    o.order_status,
    o.order_total,
    o.created_at
from {{ ref('stg_orders') }} o
join {{ ref('dim_customers') }} c on o.customer_id = c.customer_id
where o.order_status = 'completed'