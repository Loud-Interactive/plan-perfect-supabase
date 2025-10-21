-- Handle orphaned content_plan_outlines records
-- These are outlines that reference non-existent content_plans
-- This migration MUST run BEFORE 20251014_fix_guid_columns_to_uuid.sql

-- First, let's check how many orphaned records exist
-- Using explicit casts to handle mixed TEXT/UUID types
DO $$
DECLARE
  orphaned_count INT;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM content_plan_outlines cpo
  LEFT JOIN content_plans cp ON cpo.content_plan_guid::text = cp.guid::text
  WHERE cp.guid IS NULL;

  RAISE NOTICE 'Found % orphaned content_plan_outlines records', orphaned_count;
END;
$$;

-- ============================================================================
-- CHOOSE ONE OF THE OPTIONS BELOW:
-- ============================================================================

-- OPTION 1: DELETE orphaned records (RECOMMENDED - cleaner database)
-- Uncomment this block to delete orphaned outlines:
/*
DELETE FROM content_plan_outlines cpo
WHERE cpo.guid IN (
  SELECT cpo2.guid
  FROM content_plan_outlines cpo2
  LEFT JOIN content_plans cp ON cpo2.content_plan_guid::text = cp.guid::text
  WHERE cp.guid IS NULL
);
*/

-- OPTION 2: Set content_plan_guid to NULL (preserve the outline data)
-- This is the DEFAULT - it keeps the outlines but breaks the invalid relationship

-- First, drop the existing foreign key constraint so we can modify the column
ALTER TABLE content_plan_outlines
  DROP CONSTRAINT IF EXISTS content_plan_outlines_content_plan_guid_fkey;

-- Allow NULL values in content_plan_guid
ALTER TABLE content_plan_outlines
  ALTER COLUMN content_plan_guid DROP NOT NULL;

-- Set orphaned records' content_plan_guid to NULL (using ::text cast to handle type mismatches)
UPDATE content_plan_outlines cpo
SET content_plan_guid = NULL
WHERE cpo.guid IN (
  SELECT cpo2.guid
  FROM content_plan_outlines cpo2
  LEFT JOIN content_plans cp ON cpo2.content_plan_guid::text = cp.guid::text
  WHERE cp.guid IS NULL
);

-- Log the results
DO $$
DECLARE
  null_count INT;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM content_plan_outlines
  WHERE content_plan_guid IS NULL;

  RAISE NOTICE 'Set % content_plan_outlines records to NULL content_plan_guid', null_count;
END;
$$;

-- Note: The FK constraint will be recreated by the 20251014_fix_guid_columns_to_uuid.sql migration
-- which runs after this one and converts all columns to proper UUID types

COMMENT ON COLUMN content_plan_outlines.content_plan_guid IS
  'Foreign key to content_plans.guid - NULL allowed for orphaned outlines';
