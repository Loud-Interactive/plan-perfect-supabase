# Rescue Stuck Outlines & Content Jobs

This function provides a convenient endpoint to bulk-reset stuck outline generation jobs and content generation jobs.

## Overview

The system may encounter cases where outline or content generation jobs become stuck due to:
- Edge function timeouts
- External API failures
- Intermittent network issues
- Unexpected errors

This function allows administrators to rescue such jobs without manual intervention.

## Parameters

- `job_type`: (Required) Type of job to rescue, either "outline" or "content"
- `min_age_minutes`: (Optional) Minimum age in minutes for jobs to be considered stuck, default is 30 minutes
- `max_jobs`: (Optional) Maximum number of jobs to rescue in one call, default is 10

## Rescue Process

For outline generation jobs:
1. Find jobs with stale heartbeats (older than min_age_minutes)
2. Jobs must be in a non-terminal state (not 'completed' or 'failed')
3. Reset each job's status to 'pending'
4. Clear any error messages
5. Update the heartbeat timestamp
6. Trigger reprocessing

For content generation jobs:
1. Find jobs with stale heartbeats (older than min_age_minutes)
2. Jobs must be in a non-terminal state (not 'completed' or 'failed')
3. Reset each job's status based on its current state:
   - 'converting' → 'converting'
   - 'assembling' → 'assembling'
   - 'processing' → 'processing'
   - 'research' → 'research'
   - All others → 'pending'
4. Reset any stuck sections
5. Reset queue entries
6. Clear any error messages
7. Update the heartbeat timestamp
8. Trigger reprocessing

## Example Usage

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/bulk-rescue-stuck-outlines" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -d '{
    "job_type": "content",
    "min_age_minutes": 60,
    "max_jobs": 5
  }'
```

## Response

```json
{
  "success": true,
  "message": "Successfully rescued stuck jobs",
  "data": {
    "rescued_jobs": 3,
    "job_ids": ["uuid1", "uuid2", "uuid3"]
  },
  "timestamp": "2025-04-15T12:34:56.789Z"
}
```

## Cron Job Setup

To automatically rescue stuck jobs, set up a cron job:

```sql
-- Run every 15 minutes
select cron.schedule(
  'rescue-stuck-jobs',
  '*/15 * * * *',
  $$
  select
    pg_net.http_post(
      '{{supabase_url}}/functions/v1/bulk-rescue-stuck-outlines',
      '{"job_type": "outline", "min_age_minutes": 30, "max_jobs": 10}',
      '{"Content-Type": "application/json", "Authorization": "Bearer {{anon_key}}"}'
    );
  
  select
    pg_net.http_post(
      '{{supabase_url}}/functions/v1/bulk-rescue-stuck-outlines',
      '{"job_type": "content", "min_age_minutes": 30, "max_jobs": 10}',
      '{"Content-Type": "application/json", "Authorization": "Bearer {{anon_key}}"}'
    );
  $$
);
```