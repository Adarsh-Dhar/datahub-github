# DataHub PR Guardian

DataHub PR Guardian is a GitHub Action for dbt projects. It compares changed SQL
models in a pull request, detects structural changes, retrieves downstream
lineage from DataHub, and adds one updatable risk comment to the pull request.

It detects dropped and renamed columns, explicit cast changes, and changed join
conditions. On a merged pull request, the optional writeback workflow records
the reviewed impact in DataHub.

## Architecture

1. GitHub provides the base and head commits to the action.
2. The action reads changed files under models and analyzes their SELECT lists.
3. DataHub GraphQL searchAcrossLineage queries two downstream hops.
4. GitHub Models generates a short, owner-aware impact summary.
5. A hidden HTML marker lets the action update one comment rather than spam a
   new comment on every push.

## Setup

1. Install Node 20 or newer and run:

   ~~~sh
   npm install
   npm test
   ~~~

2. Install the local demo tooling, then ingest the demo project before opening
   a demonstration pull request:

   ~~~sh
   python3 -m pip install 'acryl-datahub[dbt]' dbt-duckdb
   cd ../pr-guardian-demo
   dbt seed --profiles-dir .
   dbt build --profiles-dir .
   dbt docs generate --profiles-dir .
   datahub ingest run -c datahub-ingestion.yml
   ~~~

3. Add these repository secrets. DATAHUB_GMS_URL must be reachable from
   GitHub-hosted runners; localhost only works for local validation.

   - DATAHUB_GMS_URL: the URL of your DataHub GMS service.
   - DATAHUB_TOKEN: a DataHub personal access token.
   - MODELS_TOKEN: a token that can call GitHub Models.

4. Update the Action reference in the demo workflow from
   your-github-handle/datahub-pr-guardian to your repository owner.

The action itself accepts the same values as inputs. Its composite definition
installs its own dependencies and runs against the caller repository, so it can
be used directly by the demo project.

## DataHub configuration

The default dataset URN is:

~~~
urn:li:dataset:(urn:li:dataPlatform:dbt,MODEL_NAME,PROD)
~~~

Set DATAHUB_PLATFORM, DATAHUB_ENV, or DATAHUB_DATASET_PREFIX when the dbt
ingestion recipe uses a different platform, environment, or dataset namespace.
The included local recipe uses platform duckdb and environment PROD. Its dbt
manifest resolves fct_revenue to pr_guardian_demo.main.fct_revenue, so the demo
workflow passes that value as its dataset-prefix input. Copy one URN from
DataHub's UI before a non-demo deployment and adjust the optional prefix when
its dataset name includes a database or schema.

The lineaged lookup uses DataHub GraphQL searchAcrossLineage with DOWNSTREAM
direction and degree 1 and 2 filters. The writeback mutation is intentionally
isolated in src/datahub/writeback.js because its exact mutation shape varies by
DataHub release. It was validated with local DataHub v1.5.0.6 and appends each
review once to the dataset's editable description; verify it against your
deployed schema before enabling it.

## Demo flow

Open a pull request in pr-guardian-demo that removes customer_id from
models/staging/stg_orders.sql. Once the baseline project has been ingested, the
PR comment should identify fct_revenue and dim_customers as downstream assets.
After the PR is merged, the demo writeback workflow appends its review to the
changed asset in DataHub. A rendered example is in examples/sample-pr-comment.md.
