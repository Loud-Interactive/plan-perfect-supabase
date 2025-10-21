-- Check RLS policies on tasks table that might be blocking updates
\echo '=== RLS STATUS ON TASKS TABLE ==='
SELECT
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'tasks';

\echo '\n=== RLS POLICIES ON TASKS TABLE ==='
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd as command,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'tasks'
ORDER BY policyname;
