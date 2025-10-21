-- Fix content_plan_posts table columns
-- Convert remaining UUID columns to TEXT and drop old backup columns

-- Step 1: Drop RLS policy that depends on content_plan_outline_guid_uuid
DROP POLICY IF EXISTS posts_by_outline_uuid ON content_plan_posts;

-- Step 2: Drop any foreign key constraints we need to drop
ALTER TABLE content_plan_posts
  DROP CONSTRAINT IF EXISTS content_plan_posts_content_plan_outline_guid_uuid_fkey;

ALTER TABLE content_plan_posts
  DROP CONSTRAINT IF EXISTS content_plan_posts_content_plan_guid_uuid_old_fkey;

ALTER TABLE content_plan_posts
  DROP CONSTRAINT IF EXISTS content_plan_posts_content_plan_outline_guid_uuid_old_fkey;

-- Step 3: Convert content_plan_outline_guid_uuid from UUID to TEXT
ALTER TABLE content_plan_posts
  ALTER COLUMN content_plan_outline_guid_uuid TYPE TEXT USING content_plan_outline_guid_uuid::text;

-- Drop the old backup columns (they're redundant now)
ALTER TABLE content_plan_posts
  DROP COLUMN IF EXISTS content_plan_outline_guid_uuid_old;

ALTER TABLE content_plan_posts
  DROP COLUMN IF EXISTS content_plan_guid_uuid_old;

-- Verify the changes
DO $$
DECLARE
  guid_cols RECORD;
BEGIN
  RAISE NOTICE '=== content_plan_posts GUID columns after cleanup ===';

  FOR guid_cols IN
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'content_plan_posts'
      AND column_name LIKE '%guid%'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  %: %', guid_cols.column_name, guid_cols.data_type;
  END LOOP;
END;
$$;

-- Step 4: Recreate the RLS policy (now works with TEXT column)
-- Note: The original policy compared UUID to auth.uid() which won't work with TEXT
-- We'll recreate it but it may need adjustment based on your auth setup
CREATE POLICY posts_by_outline_uuid ON content_plan_posts
  FOR SELECT
  TO authenticated
  USING (
    content_plan_outline_guid_uuid IS NOT NULL
    AND content_plan_outline_guid_uuid::text = auth.uid()::text
  );

COMMENT ON COLUMN content_plan_posts.guid IS 'Primary key as TEXT';
COMMENT ON COLUMN content_plan_posts.content_plan_outline_guid IS 'Foreign key to content_plan_outlines.guid (TEXT)';
COMMENT ON COLUMN content_plan_posts.content_plan_guid IS 'Foreign key to content_plans.guid (TEXT)';
COMMENT ON COLUMN content_plan_posts.content_plan_outline_guid_uuid IS 'Converted to TEXT for consistency - used in RLS policy';
