-- Check triggers on tasks table
SELECT
    t.tgname AS trigger_name,
    pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'tasks'
  AND NOT t.tgisinternal;
