-- Check constraints and triggers on content_plan_outlines
SELECT 
  'Constraints' as type,
  conname as name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'content_plan_outlines'::regclass;

-- Check triggers
SELECT 
  'Triggers' as type,
  tgname as name,
  pg_get_triggerdef(oid) as definition
FROM pg_trigger
WHERE tgrelid = 'content_plan_outlines'::regclass
  AND tgisinternal = false;

-- Check the actual column default more carefully
SELECT 
  column_name,
  column_default,
  data_type
FROM information_schema.columns
WHERE table_name = 'content_plan_outlines'
  AND column_name IN ('guid', 'content_plan_guid', 'guid_text');
