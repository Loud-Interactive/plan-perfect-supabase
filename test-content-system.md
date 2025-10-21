# Test PlanPerfect Content Generation System

## ✅ Pre-Test Checklist

Before testing, confirm these migrations ran successfully:

1. ☐ `20250919_content_jobs.sql` - Content jobs infrastructure
2. ☐ `20250919_create_content_queue.sql` - PGMQ queues
3. ☐ `20251016112651_content_queue_hardening.sql` - Queue hardening
4. ☐ `20251020120000_content_dispatcher.sql` - Dispatcher and cron
5. ☐ `20251014_create_update_task_by_id_rpc.sql` - Task update RPC (for generate-side-by-side)

Run this SQL to verify tables exist:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('content_jobs', 'content_payloads', 'content_job_events', 'content_stage_config');
```

Run this SQL to verify queues exist:
```sql
SELECT * FROM pgmq.list_queues();
```

## 🚀 Testing Steps

### Step 1: Check Edge Functions

List deployed edge functions:
```bash
supabase functions list
```

Required functions for testing:
- ✅ `content-intake` - Entry point
- ✅ `content-research-worker` - Stage 1
- ✅ `content-outline-worker` - Stage 2
- ✅ `content-draft-worker` - Stage 3
- ✅ `content-qa-worker` - Stage 4
- ✅ `content-export-worker` - Stage 5
- ✅ `content-complete-worker` - Stage 6
- ✅ `content-queue-dispatcher` - Orchestration

### Step 2: Verify Dispatcher Configuration

Check dispatcher config:
```sql
SELECT * FROM public.content_stage_config ORDER BY stage;
```

### Step 3: Submit a Test Job

Use the test script: `test-content-intake.py` (created below)

### Step 4: Monitor Job Progress

**Option A - SQL Monitoring:**
```sql
-- Check job status
SELECT id, job_type, status, stage, created_at, updated_at 
FROM content_jobs 
ORDER BY created_at DESC 
LIMIT 5;

-- Check stage progress
SELECT j.id, j.status, j.stage, s.stage as stage_name, s.status as stage_status, s.attempt_count
FROM content_jobs j
LEFT JOIN content_job_stages s ON j.id = s.job_id
WHERE j.id = 'YOUR-JOB-ID-HERE'
ORDER BY s.stage;

-- Check events
SELECT job_id, stage, status, message, created_at 
FROM content_job_events 
WHERE job_id = 'YOUR-JOB-ID-HERE'
ORDER BY created_at DESC;

-- Check queue depth
SELECT * FROM public.get_content_stage_backlog();
```

**Option B - Python Monitoring Script:**
See `monitor-content-job.py` (created below)

## 🔍 What Information I Need

To help you test, please provide:

1. **Migration Status:**
   ```bash
   # Did all migrations run successfully?
   supabase db push --include-all --dry-run
   ```

2. **Deployed Functions:**
   ```bash
   supabase functions list
   ```

3. **Your Supabase URL and Keys:**
   - Do you have `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your environment?

4. **Test Parameters:**
   - What type of content do you want to test? (article, blog post, etc.)
   - Any specific topic or keywords?

## 🐛 Troubleshooting

### Job Stuck in "queued" Status
- Check if dispatcher cron is running: `SELECT * FROM cron.job WHERE jobname = 'planperfect-content-queue-dispatcher';`
- Check queue depth: `SELECT * FROM public.get_content_stage_backlog();`
- Manually trigger dispatcher: See test script below

### Job Failed
- Check events: `SELECT * FROM content_job_events WHERE job_id = 'YOUR-JOB-ID' ORDER BY created_at;`
- Check stage status: `SELECT * FROM content_job_stages WHERE job_id = 'YOUR-JOB-ID';`

### Workers Not Running
- Verify worker functions are deployed
- Check worker endpoint URLs in `content_stage_config`
- Test worker manually: See test script below

