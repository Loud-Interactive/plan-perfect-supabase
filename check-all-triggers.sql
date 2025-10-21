-- Check all triggers in the database
-- Part 1: List all triggers
SELECT
    schemaname,
    tablename,
    triggername,
    pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE NOT tgisinternal
ORDER BY schemaname, tablename, triggername;

-- Part 2: List all triggers specifically on tasks table
\echo '\n=== TRIGGERS ON TASKS TABLE ==='
SELECT
    triggername,
    pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'tasks'
  AND NOT tgisinternal
ORDER BY triggername;

-- Part 3: List all trigger functions that mention 'tasks' or 'task_id'
\echo '\n=== TRIGGER FUNCTIONS THAT REFERENCE TASKS ==='
SELECT
    n.nspname as schema,
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prorettype = 'trigger'::regtype
  AND (
    pg_get_functiondef(p.oid) ILIKE '%tasks%'
    OR pg_get_functiondef(p.oid) ILIKE '%task_id%'
  )
ORDER BY n.nspname, p.proname;
