# PlanPerfect Pipeline Monitoring

This document describes how to observe, monitor, and alert on the PlanPerfect content pipeline. The observability stack combines database-level metrics, Supabase Edge Functions, and a lightweight CLI script that can be scheduled via cron or integrated into dashboards.

## Database Metrics

Two primary database artifacts power the monitoring flow:

- **`content_job_metrics`** – Fact table that captures per-stage metrics such as attempt counts, durations (in milliseconds), failure events, and periodic queue depth snapshots. Records are appended automatically by the PlanPerfect workers through the shared helpers (`insertEvent`, `startStage`, `completeStage`, `failStage`). Historical data is backfilled during migration.
- **`v_content_metrics_summary`** – Hourly materialized view that aggregates recent metrics (last 7 days) for fast queries. Use the helper function `refresh_content_metrics_summary()` to refresh the view concurrently when needed.

Additional helper functions:

- `record_job_metric(...)` – Inserts structured metrics rows.
- `capture_queue_depth_snapshot()` – Captures queue depth snapshots by stage on demand (e.g., via cron).
- `get_pipeline_health_status(...)` – Evaluates health thresholds for durations, error rates, and queue depth.
- `pg_net_webhook(...)` – Sends alerts through the `pg_net.webhook` interface with an optional HTTP fallback.

## Edge Functions

Two new Supabase Edge Functions expose metrics externally:

### `content-metrics`

- **Method:** `GET`
- **Query Parameters:**
  - `summary=true` to return aggregated rows from the materialized view (default is raw metrics).
  - `time_window` (default `1h`, accepts `5m`, `15m`, `1h`, `6h`, `24h`, `7d`).
  - Optional `stage` and `metric_type` filters.
- **Response:** JSON containing either raw metric rows or summary statistics. Aggregations include count, min, max, average, and percentile estimates.

### `content-healthcheck`

- **Method:** `GET` or `POST`
- **Query Parameters:**
  - `duration_threshold_ms` (default `300000` / 5 minutes).
  - `error_rate_threshold` (default `0.1`).
  - `queue_depth_threshold` (default `100`).
  - `send_alert=true` to forward critical alerts via `pg_net_webhook`.
- **Response:** JSON containing the evaluated health status (`healthy`, `degraded`, `unhealthy`), current thresholds, and any active alerts. HTTP status is `503` when the pipeline is unhealthy.

When `send_alert=true` and at least one alert is marked `critical`, the function invokes `pg_net_webhook`. Configure the webhook name and fallback URL via environment variables:

- `HEALTH_ALERT_WEBHOOK_NAME` (optional; defaults to `content_pipeline_alerts`).
- `HEALTH_ALERT_WEBHOOK_URL` (optional fallback HTTP endpoint).

## CLI Monitoring Script

The script `scripts/monitor-content-pipeline.ts` is suitable for cron jobs, CI checks, or dashboard integrations. It calls the edge functions, prints summarized metrics, and exits with non-zero codes when thresholds are breached.

### Usage

```bash
denp run --allow-env --allow-net scripts/monitor-content-pipeline.ts \
  --base-url https://YOUR_PROJECT.supabase.co/functions/v1 \
  --api-key $SUPABASE_SERVICE_ROLE_KEY \
  --time-window 1h \
  --stage outline \
  --metric-type duration \
  --send-alert
```

Arguments:

- `--base-url` _(required)_ – Supabase Functions base URL.
- `--api-key` _(optional)_ – API key (defaults to `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`).
- `--time-window` – Matching the edge function `time_window` (default `1h`).
- `--stage` / `--metric-type` – Optional filters.
- `--send-alert` – Forward alerts via `content-healthcheck`.

Environment variables can provide defaults:

- `SUPABASE_FUNCTIONS_URL`
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`
- `PIPELINE_SEND_ALERTS`

### Exit Codes

- `0` – Pipeline is healthy.
- `2` – Pipeline reported `unhealthy`.
- `3` – Pipeline reported `degraded`.
- `1` – Monitoring run failed (network errors, invalid responses, etc.).

Schedule the script via cron (e.g., every 5 minutes) to log metrics and trigger alerts:

```
*/5 * * * * deno run --allow-env --allow-net /path/to/repo/scripts/monitor-content-pipeline.ts --base-url https://YOUR_PROJECT.supabase.co/functions/v1 --send-alert >> /var/log/planperfect-monitor.log 2>&1
```

## Alerting Configuration

1. Register a webhook in the database via `pg_net` (e.g., `content_pipeline_alerts`).
2. Set the environment variables for the edge function deployment:
   - `HEALTH_ALERT_WEBHOOK_NAME`
   - `HEALTH_ALERT_WEBHOOK_URL` (optional fallback)
3. Enable `--send-alert` in monitoring invocations or append `send_alert=true` to ad-hoc requests.

The fallback ensures alerts are still delivered even if `pg_net.webhook` is unavailable by posting directly to the configured URL.

## Refreshing the Summary View

To keep `v_content_metrics_summary` current, schedule a periodic refresh (e.g., hourly):

```sql
select public.refresh_content_metrics_summary();
```

This can be executed via `pg_cron`, Supabase scheduled tasks, or a CI workflow.
