-- Check current data types of all GUID columns
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE column_name IN ('guid', 'content_plan_guid', 'content_plan_guid_uuid', 'content_plan_outline_guid')
  AND table_schema = 'public'
ORDER BY table_name, column_name;
