# Content Queue Dispatcher

The Content Queue Dispatcher is a dedicated edge function responsible for horizontal scaling of PlanPerfect content generation workers. It maintains balanced queue throughput across stages by monitoring queue depth and launching workers as concurrency permits.

## Architecture

### Components

1. **Edge Function**: `content-queue-dispatcher`
   - Runs on Supabase Edge (Deno runtime)
   - Called via cron or manual trigger
   - Inspects queue depth and triggers workers

2. **Cron Schedule**: `planperfect-content-queue-dispatcher`
   - Fires every minute (`*/1 * * * *`)
   - Uses pg_net.http_post to invoke dispatcher
   - Configured in migration `20251020120000_content_dispatcher.sql`

3. **Configuration Table**: `content_stage_config`
   - One row per stage (research, outline, draft, qa, export, complete)
   - Stores worker_endpoint, max_concurrency, enabled flag
   - Can be updated at runtime to scale stages

4. **Backlog RPC**: `get_content_stage_backlog()`
   - Queries `content_job_stages` for ready and in-flight counts per stage
   - Returns structured data for dispatcher decision-making

## Configuration

### Database Table

```sql
select * from content_stage_config order by stage;
```

| Column | Description |
|--------|-------------|
| stage | Stage name (primary key) |
| queue | Target queue name (usually 'content') |
| worker_endpoint | Full URL to worker edge function |
| max_concurrency | Max parallel workers for this stage |
| trigger_batch_size | Workers to start per dispatch cycle (usually 1) |
| enabled | Boolean to pause/resume stage |
| last_updated_at | Auto-updated timestamp |

### Environment Overrides

Set environment variables to override table values:

```bash
CONTENT_STAGE_RESEARCH_MAX_CONCURRENCY=10
CONTENT_STAGE_OUTLINE_MAX_CONCURRENCY=8
CONTENT_STAGE_DRAFT_MAX_CONCURRENCY=6
```

Set to `0` to disable a stage.

## How It Works

1. Dispatcher is invoked by cron or manual trigger
2. Fetches enabled stage configs from `content_stage_config`
3. Calls `get_content_stage_backlog()` to get ready/in-flight counts
4. For each stage:
   - Checks if ready count > 0
   - Calculates available slots: `max_concurrency - in_flight`
   - If slots available, triggers workers via `trigger_content_worker()`
5. Returns JSON summary of dispatches and errors

### Example Response

```json
{
  "message": "Dispatch cycle completed",
  "dispatches": [
    {
      "stage": "research",
      "queue": "content",
      "workers_triggered": 2
    },
    {
      "stage": "outline",
      "queue": "content",
      "workers_triggered": 1
    }
  ],
  "duration_ms": 234
}
```

## Operational Playbooks

### Scale Up a Stage

Update the database:

```sql
update content_stage_config
set max_concurrency = 10
where stage = 'research';
```

Or set environment variable and restart functions.

### Pause a Stage

```sql
update content_stage_config
set enabled = false
where stage = 'draft';
```

Or set `CONTENT_STAGE_DRAFT_MAX_CONCURRENCY=0` in environment.

### Manual Trigger

```bash
cd /home/engine/project
deno run --allow-net --allow-env scripts/trigger-content-dispatcher.ts
```

Or via curl:

```bash
curl -X POST \
  https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/content-queue-dispatcher \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual"}'
```

### Check Backlog

```sql
select * from get_content_stage_backlog() order by stage;
```

### View Cron Jobs

```sql
select jobname, schedule, active
from cron.job
where jobname like '%dispatcher%';
```

## Troubleshooting

### Dispatcher Not Running

1. Check cron job is active:
   ```sql
   select * from cron.job where jobname = 'planperfect-content-queue-dispatcher';
   ```

2. Check cron logs (if available in Supabase Dashboard)

3. Manually trigger to see error output

### Workers Not Triggering

1. Check stage is enabled:
   ```sql
   select * from content_stage_config where stage = 'research';
   ```

2. Check backlog has ready jobs:
   ```sql
   select * from get_content_stage_backlog() where stage = 'research';
   ```

3. Check pg_net extension is installed:
   ```sql
   select * from pg_extension where extname = 'pg_net';
   ```

### High Queue Depth

If a stage is backing up:

1. Increase concurrency:
   ```sql
   update content_stage_config
   set max_concurrency = 20
   where stage = 'research';
   ```

2. Check worker errors in `content_job_events`:
   ```sql
   select * from content_job_events
   where stage = 'research' and status = 'error'
   order by created_at desc
   limit 10;
   ```

## Related Functions

- `trigger_content_worker()`: SQL wrapper for pg_net.http_post
- `get_content_stage_backlog()`: Aggregates queue metrics
- Worker functions: research-worker, outline-worker, draft-worker, qa-worker, export-worker, complete-worker

## Migration

Created by: `20251020120000_content_dispatcher.sql`

Includes:
- Table creation and seeding
- RPC functions
- Cron job scheduling
