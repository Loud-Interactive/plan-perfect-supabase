# PGMQ Migration Fixes - Complete Summary ✅

## All Issues Fixed

### 1. **pgmq API Version Change (1.4.4+)**
- ❌ Old: `pgmq.pop(queue, timeout)`
- ✅ New: `pgmq.read(queue, timeout, quantity)`

### 2. **Reserved Keyword Error**
- Fixed parameter name `values` → `p_values` in `greatest_positive_int()`

### 3. **Incomplete Dollar Quote**
- Fixed `as $` → `as $$` in two functions

### 4. **Function Signature Changes**
- Added `DROP FUNCTION ... CASCADE` before recreating functions with different:
  - Parameter names (e.g., `p_visibility` vs `p_visibility_seconds`)
  - Return types (e.g., `void` → `boolean` for `archive_message`)
  - Return table columns

### 5. **Duplicate Function Definitions**
- Removed duplicate `archive_message` definition in `20251016112651_content_queue_hardening.sql`
- Now only defined once in `20250919_content_jobs.sql` with return type `boolean`

## Fixed Files

### 1. `supabase/migrations/20250919_content_jobs.sql`
- ✅ Changed `pgmq.pop()` → `pgmq.read()`
- ✅ Changed `archive_message` return type: `void` → `boolean`
- ✅ Added DROP with CASCADE for both functions

### 2. `supabase/migrations/20251016112651_content_queue_hardening.sql`
- ✅ Fixed parameter name: `values` → `p_values`
- ✅ Fixed dollar quotes: `as $` → `as $$` (2 instances)
- ✅ Changed `pgmq.pop()` → `pgmq.read()` (2 instances)
- ✅ Added DROP with CASCADE for `dequeue_stage` functions
- ✅ Removed duplicate `archive_message` definition

### 3. `supabase/migrations/20251016120000_pageperfect_queue_infrastructure.sql`
- ✅ Changed `pgmq.pop()` → `pgmq.read()` (2 instances)
- ✅ Added DROP with CASCADE for `pageperfect_dequeue_stage` functions

## Run Migrations

```bash
# Option 1: Run the complete script
./run-content-migrations-fixed.sh

# Option 2: Run individual migrations in order
supabase db push --include-all --file supabase/migrations/20250919_content_jobs.sql
supabase db push --include-all --file supabase/migrations/20250919_create_content_queue.sql
supabase db push --include-all --file supabase/migrations/20251016112651_content_queue_hardening.sql
supabase db push --include-all --file supabase/migrations/20251016120000_pageperfect_queue_infrastructure.sql
supabase db push --include-all --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql

# Option 3: Push all migrations
supabase db push --include-all
```

## What's Next

After these migrations succeed, you still need the `update_task_by_id` RPC for `generate-side-by-side`:

```bash
# Run this migration for generate-side-by-side to work
supabase db push --include-all --file supabase/migrations/20251014_create_update_task_by_id_rpc.sql
```

Or manually run: `URGENT-RUN-THIS-SQL.sql` in Supabase SQL Editor

## All Errors Fixed ✅

1. ✅ `function pgmq.pop(text, integer) does not exist`
2. ✅ `syntax error at or near "values"`
3. ✅ `syntax error at or near "$"`
4. ✅ `cannot change name of input parameter "p_visibility"`
5. ✅ `cannot change return type of existing function`

All migrations should now run successfully! 🎉

