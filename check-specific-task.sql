-- Check if the specific failing task exists
\echo '=== CHECKING TASK: de7ef8be-b715-49cc-8a50-5e65463263ae ==='

-- Does this content_plan_outline_guid exist?
SELECT
    'content_plan_outlines' as table_name,
    guid,
    post_title,
    status
FROM content_plan_outlines
WHERE guid = 'de7ef8be-b715-49cc-8a50-5e65463263ae'::uuid;

\echo '\n=== TASKS WITH THIS OUTLINE GUID ==='
-- Find all tasks with this outline guid
SELECT
    task_id,
    title,
    status,
    hero_image_status,
    hero_image_url,
    created_at,
    updated_at
FROM tasks
WHERE content_plan_outline_guid = 'de7ef8be-b715-49cc-8a50-5e65463263ae'::uuid
ORDER BY created_at DESC;

\echo '\n=== CHECKING IF TASK_ID FROM EDGE FUNCTION EXISTS ==='
-- This will tell us if the task_id that the edge function is trying to update actually exists
SELECT
    task_id,
    title,
    hero_image_status,
    hero_image_url,
    hero_image_thinking
FROM tasks
WHERE content_plan_outline_guid = 'de7ef8be-b715-49cc-8a50-5e65463263ae'::uuid
LIMIT 1;
