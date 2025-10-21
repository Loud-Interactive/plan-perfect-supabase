# Migration Plan to Fix UUID/TEXT Issues

## Problem
Foreign key constraint violations when inserting into `content_plan_outlines`:
```
ERROR: insert or update on table "content_plan_outlines" violates foreign key constraint
Key (content_plan_guid)=(1f990fc4-e796-4a7e-a1b5-236d7c1f0fbd) is not present in table "content_plans"
```

This happens because:
1. Some GUID columns were incorrectly changed from UUID to TEXT
2. Orphaned records exist (outlines referencing non-existent content_plans)
3. Foreign key constraints are enforcing referential integrity with mismatched types

## Solution Overview

We have 7 migrations that will run in this order:

### 1. `20251014_1_handle_orphaned_outlines.sql` (RUNS FIRST)
**What it does:**
- Drops the FK constraint temporarily
- Allows NULL in `content_plan_outlines.content_plan_guid`
- Sets orphaned records to NULL (preserving the outline data)
- Uses `::text` casts to handle mixed UUID/TEXT types

**Why it runs first:**
- Must clean up orphaned data BEFORE recreating FK constraints
- Handles type mismatches gracefully

### 2. `20251014_2_fix_guid_columns_to_uuid.sql` (RUNS SECOND)
**What it does:**
- Validates all GUID data is valid UUID format
- Converts these columns from TEXT to UUID:
  - `content_plans.guid`
  - `content_plan_outlines.guid`
  - `tasks.content_plan_guid_uuid`
  - `tasks.content_plan_outline_guid`
- Recreates all FK constraints with matching UUID types

**Why it runs second:**
- Orphaned data is already cleaned up
- All columns can now safely convert to UUID
- FK constraints will work properly

### 3-7. RPC Helper Functions
- `20251014_create_save_outline_rpc.sql`
- `20251014_create_update_task_by_id_rpc.sql`
- `20251014_create_update_task_hero_image_rpc.sql`
- `20251014_create_update_task_live_post_url_rpc.sql`
- `20251014_create_content_plan_helper_rpcs.sql`

These create database functions that handle TEXT→UUID casting for Supabase JS client.

## What Gets Fixed

✅ **Foreign key violations** - Orphaned records set to NULL
✅ **Type mismatches** - All GUID columns properly typed as UUID
✅ **Hero image updates** - Triggers disabled during RPC updates
✅ **Live post URL updates** - Triggers disabled during RPC updates
✅ **Python SQLAlchemy JOINs** - UUID = UUID comparisons work properly
✅ **Supabase JS queries** - RPC functions handle TEXT→UUID casting

## Apply Migrations

```bash
supabase db push
```

## After Migration

The database will have:
- All GUID columns as UUID type
- No orphaned `content_plan_outlines` records (they'll have NULL `content_plan_guid`)
- Proper FK constraints enforcing referential integrity
- RPC helper functions for queries that need UUID casting

## If You Want to Delete Orphaned Records Instead

Edit `20251014_1_handle_orphaned_outlines.sql` and uncomment Option 1:

```sql
-- OPTION 1: DELETE orphaned records (RECOMMENDED - cleaner database)
-- Uncomment this block to delete orphaned outlines:
DELETE FROM content_plan_outlines cpo
WHERE cpo.guid IN (
  SELECT cpo2.guid
  FROM content_plan_outlines cpo2
  LEFT JOIN content_plans cp ON cpo2.content_plan_guid::text = cp.guid::text
  WHERE cp.guid IS NULL
);
```

Then comment out Option 2 (the UPDATE and ALTER statements).
