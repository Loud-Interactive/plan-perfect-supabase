-- Check the actual code of suspicious trigger functions
\echo '=== fn_request_hero_image (PRIME SUSPECT) ==='
SELECT pg_get_functiondef('fn_request_hero_image'::regproc);

\echo '\n=== normalize_task_status_completed ==='
SELECT pg_get_functiondef('normalize_task_status_completed'::regproc);

\echo '\n=== fn_handle_task_content_update ==='
SELECT pg_get_functiondef('fn_handle_task_content_update'::regproc);

\echo '\n=== trigger_task_webhook ==='
SELECT pg_get_functiondef('trigger_task_webhook'::regproc);

\echo '\n=== test_trigger_function (WHY IS THIS IN PRODUCTION?) ==='
SELECT pg_get_functiondef('test_trigger_function'::regproc);
