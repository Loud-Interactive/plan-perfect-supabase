# PGMQ Migration Fix Summary ✅

## Problem
The content generation migrations were written for an older version of pgmq. When you enabled pgmq 1.4.4, the API differences caused errors:
- **Error**: `function pgmq.pop(text, integer) does not exist`

## What Changed in pgmq 1.4.4+
- ❌ **Old API**: `pgmq.pop(queue_name, visibility_timeout)`
- ✅ **New API**: `pgmq.read(queue_name, visibility_timeout, quantity)`

## Files Fixed
I've updated all 3 migrations to use the new pgmq 1.4.4+ API:

1. **`20250919_content_jobs.sql`**
   - Fixed `dequeue_stage()` function
   - Fixed `archive_message()` return type (void → boolean)

2. **`20251016112651_content_queue_hardening.sql`**
   - Fixed `dequeue_stage_with_tracking()` function
   - Fixed `dequeue_stage_batch()` function

3. **`20251016120000_pageperfect_queue_infrastructure.sql`**
   - Fixed `pageperfect_dequeue_stage()` function
   - Fixed `pageperfect_dequeue_stage_batch()` function

## Next Steps

### Option 1: Run All Content Migrations (Recommended)
```bash
./run-content-migrations-fixed.sh
```

### Option 2: Run Individual Migration
```bash
supabase db push --include-all --file supabase/migrations/20250919_content_jobs.sql
```

### Option 3: Run All Migrations
```bash
supabase db push --include-all
```

## Verify It Worked
After running migrations, check that the functions exist:

```sql
-- Should return results now (no errors)
SELECT proname, pg_get_function_arguments(oid) 
FROM pg_proc 
WHERE proname IN ('dequeue_stage', 'archive_message')
  AND pronamespace = 'public'::regnamespace;
```

## What's Next for generate-side-by-side
After these content migrations work, you still need to run:

```bash
supabase db push --include-all --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql
```

Or manually run the SQL in `URGENT-RUN-THIS-SQL.sql` to enable database saves in `generate-side-by-side`.

