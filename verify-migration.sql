-- Verify all migrations completed successfully

-- 1. Check all GUID columns are now UUID type
SELECT
  '1. GUID Column Types' as check_name,
  table_name,
  column_name,
  data_type,
  is_nullable,
  CASE
    WHEN data_type = 'uuid' THEN '✅ CORRECT'
    ELSE '❌ WRONG TYPE: ' || data_type
  END as status
FROM information_schema.columns
WHERE column_name IN ('guid', 'content_plan_guid', 'content_plan_guid_uuid', 'content_plan_outline_guid')
  AND table_schema = 'public'
ORDER BY table_name, column_name;

-- 2. Check for orphaned content_plan_outlines
SELECT
  '2. Orphaned Outlines' as check_name,
  COUNT(*) as orphaned_count,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned records'
    ELSE '⚠️ ' || COUNT(*) || ' records with NULL content_plan_guid'
  END as status
FROM content_plan_outlines
WHERE content_plan_guid IS NULL;

-- 3. Check foreign key constraints exist
SELECT
  '3. Foreign Key Constraints' as check_name,
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  '✅ EXISTS' as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND (
    tc.constraint_name LIKE '%content_plan%'
    OR tc.constraint_name LIKE '%outline%'
  )
ORDER BY tc.table_name, tc.constraint_name;

-- 4. Check RPC functions exist
SELECT
  '4. RPC Helper Functions' as check_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  '✅ EXISTS' as status
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN (
    'save_outline',
    'update_task_by_id',
    'update_task_hero_image',
    'update_task_live_post_url',
    'get_content_plan_by_guid',
    'get_content_plans_by_domain',
    'update_content_plan_by_guid'
  )
ORDER BY p.proname;

-- 5. Test a simple JOIN to verify types match
SELECT
  '5. JOIN Test' as check_name,
  COUNT(*) as valid_relationships,
  '✅ JOIN works without type casting' as status
FROM content_plan_outlines cpo
INNER JOIN content_plans cp ON cpo.content_plan_guid = cp.guid;

-- Summary
SELECT
  '====== MIGRATION VERIFICATION SUMMARY ======' as summary,
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE column_name IN ('guid', 'content_plan_guid', 'content_plan_guid_uuid', 'content_plan_outline_guid')
        AND table_schema = 'public'
        AND data_type != 'uuid'
    ) = 0
    THEN '✅ All GUID columns are UUID type'
    ELSE '❌ Some GUID columns are not UUID type'
  END as guid_types_status;
