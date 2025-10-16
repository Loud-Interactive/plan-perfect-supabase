# Scripts Directory

This directory contains standalone scripts for managing, monitoring, and maintaining the PlanPerfect content pipeline.

## Available Scripts

### `monitor-content-pipeline.ts`

Real-time monitoring CLI for the PlanPerfect pipeline that queries the `content-metrics` and `content-healthcheck` edge functions.

**Usage:**

```bash
deno run --allow-env --allow-net scripts/monitor-content-pipeline.ts \
  --base-url https://YOUR_PROJECT.supabase.co/functions/v1 \
  --api-key $SUPABASE_SERVICE_ROLE_KEY \
  --time-window 1h \
  --send-alert
```

**Arguments:**

- `--base-url` _(required)_ – Supabase Functions base URL
- `--api-key` _(optional)_ – Service role key or anon key
- `--time-window` – Time window for metrics (`5m`, `15m`, `1h`, `6h`, `24h`, `7d`)
- `--stage` – Filter by stage name (e.g., `outline`, `research`)
- `--metric-type` – Filter by metric type (`duration`, `failure`, `attempt`, `queue_depth`)
- `--send-alert` – Send alerts on critical issues

**Environment Variables:**

- `SUPABASE_FUNCTIONS_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`
- `PIPELINE_SEND_ALERTS=true`

**Exit Codes:**

- `0` – Pipeline healthy
- `2` – Pipeline unhealthy
- `3` – Pipeline degraded
- `1` – Monitoring error

See [docs/monitoring.md](../docs/monitoring.md) for complete documentation.
