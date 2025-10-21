-- Check if content generation system is ready for deployment

-- 1. Check if pgmq extension is installed
SELECT extname, extversion 
FROM pg_extension 
WHERE extname = 'pgmq';

-- 2. Check if content tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'content_jobs', 
    'content_payloads', 
    'content_job_events', 
    'content_job_stages',
    'content_stage_config',
    'content_assets'
  )
ORDER BY table_name;

-- 3. Check if pgmq queues exist
SELECT queue_name 
FROM pgmq.list_queues() 
WHERE queue_name IN ('content', 'schema', 'tsv');

-- 4. Check if key functions exist
SELECT proname as function_name
FROM pg_proc 
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'enqueue_stage',
    'dequeue_stage', 
    'archive_message',
    'create_content_job',
    'get_content_stage_backlog'
  )
ORDER BY proname;

-- 5. Check if dispatcher config is set up
SELECT stage, queue, worker_endpoint, max_concurrency, enabled
FROM content_stage_config
ORDER BY stage;

-- 6. Check if pg_net and pg_cron are installed
SELECT extname, extversion 
FROM pg_extension 
WHERE extname IN ('pg_net', 'pg_cron');

