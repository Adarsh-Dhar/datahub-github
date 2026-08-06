from airflow import DAG
from airflow.operators.dummy import DummyOperator
from datetime import datetime

with DAG(
    'example_revenue_dag',
    start_date=datetime(2024, 1, 1),
    schedule_interval='@daily',
) as dag:
    
    # Task that processes revenue data
    process_revenue = DummyOperator(
        task_id='process_revenue',
        destination_table='fct_revenue_v2'
    )
    
    # Task that processes customer data
    process_customers = DummyOperator(
        task_id='process_customers',
        destination_table='dim_customers'
    )
    
    process_revenue >> process_customers