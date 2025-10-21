## How to Fix "uuid = text" Errors in TypeScript Edge Functions

### Problem
All `.eq('task_id', ...)` calls fail with:
```
ERROR: column "task_id" is of type uuid but expression is of type text
```

### Solution
Use the new RPC functions instead of direct `.eq()` queries.

---

## Pattern 1: Get Single Task

### ❌ OLD (Broken):
```typescript
const { data: task, error } = await supabase
  .from('tasks')
  .select('*')
  .eq('task_id', task_id)
  .single();
```

### ✅ NEW (Working):
```typescript
const { data: tasks, error } = await supabase
  .rpc('get_task_by_id', { p_task_id: task_id });

const task = tasks?.[0] || null;
```

---

## Pattern 2: Get Tasks by Outline GUID

### ❌ OLD (Broken):
```typescript
const { data: tasks, error } = await supabase
  .from('tasks')
  .select('*')
  .eq('content_plan_outline_guid', outline_guid);
```

### ✅ NEW (Working):
```typescript
const { data: tasks, error } = await supabase
  .rpc('get_tasks_by_outline_guid', { p_outline_guid: outline_guid });
```

---

## Pattern 3: Update Task Status

### ❌ OLD (Broken):
```typescript
const { data, error } = await supabase
  .from('tasks')
  .update({
    status: 'completed',
    meta_description: 'Some description'
  })
  .eq('task_id', task_id);
```

### ✅ NEW (Working):
```typescript
const { data: success, error } = await supabase
  .rpc('update_task_status_by_id', {
    p_task_id: task_id,
    p_status: 'completed',
    p_additional_data: {
      meta_description: 'Some description'
    }
  });
```

---

## Pattern 4: Update Hero Image (Already Fixed)

Use the existing RPC:
```typescript
const { data: success, error } = await supabase
  .rpc('update_task_hero_image', {
    p_task_id: task_id,
    p_hero_image_url: url,
    p_hero_image_status: 'Generated',
    p_hero_image_thinking: thinkingText
  });
```

---

## Pattern 5: Update Live Post URL (Already Fixed)

Use the existing RPC:
```typescript
const { data: success, error } = await supabase
  .rpc('update_task_live_post_url', {
    p_task_id: task_id,
    p_live_post_url: url,
    p_last_updated_at: new Date().toISOString()
  });
```

---

## Pattern 6: Delete Task

### ❌ OLD (Broken):
```typescript
const { error } = await supabase
  .from('tasks')
  .delete()
  .eq('task_id', task_id);
```

### ✅ NEW (Working):
```typescript
const { data: success, error } = await supabase
  .rpc('delete_task_by_id', { p_task_id: task_id });
```

---

## Available RPC Functions

### Query Functions (return SETOF tasks):
- `get_task_by_id(p_task_id TEXT)` - Get single task by ID
- `get_tasks_by_outline_guid(p_outline_guid TEXT)` - Get tasks by outline GUID
- `get_tasks_by_content_plan_guid(p_content_plan_guid TEXT)` - Get tasks by content plan GUID

### Update Functions (return BOOLEAN):
- `update_task_by_id(...)` - Generic task update (flexible columns)
- `update_task_status_by_id(p_task_id, p_status, p_additional_data)` - Update status + optional fields
- `update_task_hero_image(...)` - Update hero image fields
- `update_task_live_post_url(...)` - Update live post URL

### Delete Functions (return BOOLEAN):
- `delete_task_by_id(p_task_id TEXT)` - Delete task

---

## Which Files Need Updating?

Run this command to find all files that need updating:
```bash
grep -r "\.eq('task_id'" supabase/functions/ --include="*.ts"
```

### High Priority Files (Most Used):
1. `/supabase/functions/update-task-status/index.ts`
2. `/supabase/functions/generate-index/index.ts`
3. `/supabase/functions/generate-meta-description/index.ts`
4. `/supabase/functions/generate-factcheck/index.ts`
5. `/supabase/functions/publish-to-builder-io/index.ts`
6. `/supabase/functions/api/index.ts`

---

## Migration Steps

1. Apply the new RPC migration:
```bash
supabase db push
```

2. Update TypeScript files one by one using the patterns above

3. Test each edge function after updating

4. Monitor logs for any remaining "uuid = text" errors
