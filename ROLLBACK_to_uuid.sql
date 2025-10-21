-- ROLLBACK SCRIPT: Convert TEXT back to UUID
-- Only use this if you decide to go back to UUID types
-- WARNING: This requires updating all TypeScript code to use RPC functions

-- This is the opposite of 20251014_3_convert_all_uuids_to_text.sql

-- Step 1: Drop FK constraints
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_content_plan_guid_uuid_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_content_plan_outline_guid_fkey;
ALTER TABLE content_plan_outlines DROP CONSTRAINT IF EXISTS content_plan_outlines_content_plan_guid_fkey;

-- Step 2: Convert TEXT to UUID
ALTER TABLE content_plans ALTER COLUMN guid TYPE UUID USING guid::uuid;
ALTER TABLE content_plan_outlines ALTER COLUMN guid TYPE UUID USING guid::uuid;
ALTER TABLE content_plan_outlines ALTER COLUMN content_plan_guid TYPE UUID USING content_plan_guid::uuid;
ALTER TABLE tasks ALTER COLUMN task_id TYPE UUID USING task_id::uuid;
ALTER TABLE tasks ALTER COLUMN content_plan_guid_uuid TYPE UUID USING content_plan_guid_uuid::uuid;
ALTER TABLE tasks ALTER COLUMN content_plan_outline_guid TYPE UUID USING content_plan_outline_guid::uuid;

-- Step 3: Recreate FK constraints
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

-- NOTE: After running this rollback, you MUST update all TypeScript code
-- to use RPC functions instead of .eq() queries
