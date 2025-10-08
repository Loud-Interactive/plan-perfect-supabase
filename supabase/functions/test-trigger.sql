-- Check if the trigger exists
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'update_outline_keywords_on_items_insert'
OR tgname = 'update_outline_keywords_on_items_update';

-- Check the trigger's underlying function
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'update_outline_keywords';

-- View the current state of your outline
SELECT * FROM content_plan_outlines 
WHERE post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively';

-- Try to manually update the outline
UPDATE content_plan_outlines
SET keyword = (
  SELECT keyword
  FROM content_plan_items
  WHERE post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively'
  AND content_plan_id = '9f2b7dd7-484e-473b-9094-032af0de43df'
  LIMIT 1
)
WHERE post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively'
AND (keyword IS NULL OR keyword = '');

-- View the updated outline
SELECT * FROM content_plan_outlines 
WHERE post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively';

-- Run the backfill function again to ensure it's working
SELECT backfill_outline_keywords();

-- Check the result after backfill
SELECT * FROM content_plan_outlines 
WHERE post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively';