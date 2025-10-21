# Final Migration Plan - Convert All UUIDs to TEXT

## Decision: TEXT Instead of UUID

After analysis, we're converting all UUID columns to TEXT because:
- ✅ No TypeScript code changes needed
- ✅ All existing `.eq('task_id', ...)` calls work immediately
- ✅ Simpler for the team to work with
- ✅ Avoids "uuid = text" casting errors forever
- ✅ Supabase JS client naturally sends TEXT/JSON

## What Will Happen

The migration will convert these columns from UUID → TEXT:

### content_plans table:
- `guid` (primary key)

### content_plan_outlines table:
- `guid` (primary key)
- `content_plan_guid` (foreign key to content_plans.guid)

### tasks table:
- `task_id` (primary key)
- `content_plan_guid_uuid` (foreign key to content_plans.guid)
- `content_plan_outline_guid` (foreign key to content_plan_outlines.guid)

## Migration Order

These migrations will run in sequence:

1. **20251014_1_handle_orphaned_outlines.sql** - Cleans up orphaned data
2. **20251014_2_fix_guid_columns_to_uuid.sql** - ~~Converts to UUID~~ **SKIP THIS** (superseded by #3)
3. **20251014_3_convert_all_uuids_to_text.sql** - **THE MAIN ONE** - Converts everything to TEXT
4. All the RPC helper functions - Still useful for other operations

## Before Running Migration

Check current migration status:
```bash
ls -1 supabase/migrations/20251014*.sql
```

You should see:
```
20251014_1_handle_orphaned_outlines.sql
20251014_2_fix_guid_columns_to_uuid.sql  ← This one conflicts with #3
20251014_3_convert_all_uuids_to_text.sql  ← This is the one we want
20251014_create_content_plan_helper_rpcs.sql
20251014_create_save_outline_rpc.sql
20251014_create_update_task_by_id_rpc.sql
20251014_create_update_task_hero_image_rpc.sql
20251014_create_update_task_live_post_url_rpc.sql
20251014_create_task_query_rpcs.sql
```

## Important: Skip Migration #2

**We need to delete or rename `20251014_2_fix_guid_columns_to_uuid.sql`** because it conflicts with migration #3.

Migration #2 converts to UUID, then migration #3 converts back to TEXT - that's wasteful and could cause issues.

## Apply Migrations

After removing migration #2:
```bash
supabase db push
```

## After Migration

✅ All your existing TypeScript code will work immediately
✅ No `.rpc()` calls needed for simple queries
✅ `.eq('task_id', task_id)` works everywhere
✅ Foreign key constraints still enforce referential integrity
✅ No more "uuid = text" errors

## Example Queries That Now Work

```typescript
// Get task by ID - works immediately
const { data: task } = await supabase
  .from('tasks')
  .select('*')
  .eq('task_id', task_id)
  .single();

// Update task - works immediately
const { data } = await supabase
  .from('tasks')
  .update({ status: 'completed' })
  .eq('task_id', task_id);

// Get content plan - works immediately
const { data: plan } = await supabase
  .from('content_plans')
  .select('*')
  .eq('guid', plan_guid)
  .single();
```

## Verification After Migration

Run this to verify all columns are TEXT:
```sql
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE column_name IN ('guid', 'content_plan_guid', 'content_plan_guid_uuid', 'content_plan_outline_guid', 'task_id')
  AND table_schema = 'public'
ORDER BY table_name, column_name;
```

All should show `data_type = 'text'`.

## Rollback (If Needed)

If you ever need to go back to UUID (not recommended):
```bash
psql $DATABASE_URL -f ROLLBACK_to_uuid.sql
```

But this would require updating all TypeScript code to use RPC functions.
