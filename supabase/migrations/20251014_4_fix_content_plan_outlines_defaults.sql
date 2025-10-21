-- Fix content_plan_outlines table defaults after UUID to TEXT conversion
-- The gen_random_uuid() function returns UUID, but column is now TEXT

-- Fix the guid column default to cast to TEXT
ALTER TABLE content_plan_outlines
  ALTER COLUMN guid SET DEFAULT gen_random_uuid()::text;

-- Verify the change
DO $$
DECLARE
  guid_default TEXT;
BEGIN
  SELECT column_default INTO guid_default
  FROM information_schema.columns
  WHERE table_name = 'content_plan_outlines'
    AND column_name = 'guid';

  RAISE NOTICE 'content_plan_outlines.guid default is now: %', guid_default;
END;
$$;

COMMENT ON COLUMN content_plan_outlines.guid IS
  'Primary key as TEXT - auto-generated UUID cast to TEXT for compatibility';
