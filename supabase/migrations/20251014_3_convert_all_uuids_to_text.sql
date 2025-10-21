-- Convert all UUID columns back to TEXT for Supabase JS client compatibility
-- This allows .eq() queries to work without RPC functions or explicit casting
-- Trade-off: Slightly more storage, but massively simpler application code

-- Step 1: Drop all foreign key constraints that involve UUID columns
-- We'll recreate them after the type conversion

-- Tasks table FK constraints
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_content_plan_guid_uuid_fkey;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_content_plan_outline_guid_fkey;

-- Content plan outlines FK constraint
ALTER TABLE content_plan_outlines
  DROP CONSTRAINT IF EXISTS content_plan_outlines_content_plan_guid_fkey;

-- Step 2: Convert all UUID columns to TEXT
-- PostgreSQL will automatically cast UUID to TEXT representation

-- Content Plans table
ALTER TABLE content_plans
  ALTER COLUMN guid TYPE TEXT USING guid::text;

-- Content Plan Outlines table
ALTER TABLE content_plan_outlines
  ALTER COLUMN guid TYPE TEXT USING guid::text;

ALTER TABLE content_plan_outlines
  ALTER COLUMN content_plan_guid TYPE TEXT USING content_plan_guid::text;

-- Tasks table
ALTER TABLE tasks
  ALTER COLUMN task_id TYPE TEXT USING task_id::text;

ALTER TABLE tasks
  ALTER COLUMN content_plan_guid_uuid TYPE TEXT USING content_plan_guid_uuid::text;

ALTER TABLE tasks
  ALTER COLUMN content_plan_outline_guid TYPE TEXT USING content_plan_outline_guid::text;

-- Step 3: Recreate foreign key constraints with TEXT types
ALTER TABLE tasks
  ADD CONSTRAINT tasks_content_plan_guid_uuid_fkey
  FOREIGN KEY (content_plan_guid_uuid)
  REFERENCES content_plans(guid)
  ON DELETE SET NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_content_plan_outline_guid_fkey
  FOREIGN KEY (content_plan_outline_guid)
  REFERENCES content_plan_outlines(guid)
  ON DELETE CASCADE;

ALTER TABLE content_plan_outlines
  ADD CONSTRAINT content_plan_outlines_content_plan_guid_fkey
  FOREIGN KEY (content_plan_guid)
  REFERENCES content_plans(guid)
  ON DELETE CASCADE;

-- Step 4: Add comments explaining the design decision
COMMENT ON COLUMN content_plans.guid IS
  'Primary key as TEXT - Supabase JS client sends parameters as TEXT, this avoids casting issues';

COMMENT ON COLUMN content_plan_outlines.guid IS
  'Primary key as TEXT - Supabase JS client sends parameters as TEXT, this avoids casting issues';

COMMENT ON COLUMN content_plan_outlines.content_plan_guid IS
  'Foreign key as TEXT - matches content_plans.guid type for compatibility';

COMMENT ON COLUMN tasks.task_id IS
  'Primary key as TEXT - Supabase JS client sends parameters as TEXT, this avoids casting issues';

COMMENT ON COLUMN tasks.content_plan_guid_uuid IS
  'Foreign key as TEXT - matches content_plans.guid type for compatibility';

COMMENT ON COLUMN tasks.content_plan_outline_guid IS
  'Foreign key as TEXT - matches content_plan_outlines.guid type for compatibility';

-- Step 5: Verify the conversion
DO $$
DECLARE
  cp_guid_type TEXT;
  cpo_guid_type TEXT;
  cpo_cp_guid_type TEXT;
  tasks_task_id_type TEXT;
  tasks_cp_guid_type TEXT;
  tasks_cpo_guid_type TEXT;
BEGIN
  -- Get all column types
  SELECT data_type INTO cp_guid_type
  FROM information_schema.columns
  WHERE table_name = 'content_plans' AND column_name = 'guid';

  SELECT data_type INTO cpo_guid_type
  FROM information_schema.columns
  WHERE table_name = 'content_plan_outlines' AND column_name = 'guid';

  SELECT data_type INTO cpo_cp_guid_type
  FROM information_schema.columns
  WHERE table_name = 'content_plan_outlines' AND column_name = 'content_plan_guid';

  SELECT data_type INTO tasks_task_id_type
  FROM information_schema.columns
  WHERE table_name = 'tasks' AND column_name = 'task_id';

  SELECT data_type INTO tasks_cp_guid_type
  FROM information_schema.columns
  WHERE table_name = 'tasks' AND column_name = 'content_plan_guid_uuid';

  SELECT data_type INTO tasks_cpo_guid_type
  FROM information_schema.columns
  WHERE table_name = 'tasks' AND column_name = 'content_plan_outline_guid';

  -- Log results
  RAISE NOTICE '=== Type Conversion Verification ===';
  RAISE NOTICE 'content_plans.guid: %', cp_guid_type;
  RAISE NOTICE 'content_plan_outlines.guid: %', cpo_guid_type;
  RAISE NOTICE 'content_plan_outlines.content_plan_guid: %', cpo_cp_guid_type;
  RAISE NOTICE 'tasks.task_id: %', tasks_task_id_type;
  RAISE NOTICE 'tasks.content_plan_guid_uuid: %', tasks_cp_guid_type;
  RAISE NOTICE 'tasks.content_plan_outline_guid: %', tasks_cpo_guid_type;

  -- Verify all are text
  IF cp_guid_type = 'text' AND cpo_guid_type = 'text' AND cpo_cp_guid_type = 'text'
     AND tasks_task_id_type = 'text' AND tasks_cp_guid_type = 'text' AND tasks_cpo_guid_type = 'text'
  THEN
    RAISE NOTICE '✅ All GUID/UUID columns successfully converted to TEXT';
    RAISE NOTICE '✅ Supabase JS .eq() queries will now work without casting';
  ELSE
    RAISE EXCEPTION 'Type conversion failed! Some columns are not TEXT type.';
  END IF;
END;
$$;
