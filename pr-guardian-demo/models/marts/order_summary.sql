select
    o.order_status,
    count(*) as order_count,
    sum(o.order_total) as total_revenue
from {{ ref('stg_orders') }} o
group by o.order_status
