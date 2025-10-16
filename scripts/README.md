# Scripts Directory

This directory contains operational and monitoring scripts for managing the PlanPerfect content pipeline.

## monitor-content-pipeline.ts

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

## trigger-content-dispatcher.ts

Manually triggers the content queue dispatcher to immediately scale workers based on queue depth.

**Usage:**

```bash
# Basic usage (uses environment variables)
deno run --allow-net --allow-env scripts/trigger-content-dispatcher.ts

# With explicit env vars
SUPABASE_URL=https://jsypctdhynsdqrfifvdh.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-key-here \
deno run --allow-net --allow-env scripts/trigger-content-dispatcher.ts
```

**Environment Variables:**

- `SUPABASE_URL` – Supabase project URL (defaults to production)
- `SUPABASE_SERVICE_ROLE_KEY` – Service role key (required)
- `SUPABASE_ANON_KEY` – Anon key (fallback if service role not set)

**When to Use:**

- **Force immediate scaling**: When you need to drain a backed-up queue immediately
- **Testing**: To verify dispatcher logic after configuration changes
- **Debugging**: To observe dispatcher output and identify issues

**Example Output:**

```json
{
  "message": "Dispatch cycle completed",
  "dispatches": [
    {
      "stage": "research",
      "queue": "content",
      "workers_triggered": 3
    }
  ],
  "duration_ms": 187
}
```

## Adding New Scripts

When adding scripts to this directory:

1. Use Deno with explicit permissions
2. Add a shebang line for direct execution
3. Support environment variable configuration
4. Include error handling and clear output
5. Document the script in this README
