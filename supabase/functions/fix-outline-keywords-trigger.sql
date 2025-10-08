-- Drop existing triggers and function
DROP TRIGGER IF EXISTS update_outline_keywords_on_items_insert ON content_plan_items;
DROP TRIGGER IF EXISTS update_outline_keywords_on_items_update ON content_plan_items;
DROP FUNCTION IF EXISTS update_outline_keywords();

-- Create a more robust function using LOWER() to handle case-sensitivity
CREATE OR REPLACE FUNCTION update_outline_keywords()
RETURNS TRIGGER AS $$
BEGIN
  -- Run an update for each affected row 
  -- Using LOWER() and TRIM() to handle case and whitespace differences
  UPDATE content_plan_outlines AS cpo
  SET keyword = NEW.keyword
  WHERE 
    -- Match on post title and plan relationship with case insensitivity
    LOWER(TRIM(cpo.post_title)) = LOWER(TRIM(NEW.post_title)) AND
    cpo.content_plan_guid = NEW.content_plan_id AND
    -- Only update if keyword is null or empty
    (cpo.keyword IS NULL OR cpo.keyword = '');
  
  RETURN NEW; -- for AFTER triggers on ROW level
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger that runs FOR EACH ROW instead of FOR EACH STATEMENT
CREATE TRIGGER update_outline_keywords_on_items_insert
AFTER INSERT ON content_plan_items
FOR EACH ROW
EXECUTE FUNCTION update_outline_keywords();

-- Create a trigger for updates too
CREATE TRIGGER update_outline_keywords_on_items_update
AFTER UPDATE OF keyword, post_title ON content_plan_items
FOR EACH ROW
WHEN (OLD.keyword IS DISTINCT FROM NEW.keyword OR OLD.post_title IS DISTINCT FROM NEW.post_title)
EXECUTE FUNCTION update_outline_keywords();

-- Update the backfill function to handle case insensitivity too
DROP FUNCTION IF EXISTS backfill_outline_keywords();

CREATE OR REPLACE FUNCTION backfill_outline_keywords()
RETURNS void AS $$
BEGIN
  -- Update content_plan_outlines with keywords from content_plan_items when post_title matches
  UPDATE content_plan_outlines AS cpo
  SET keyword = cpi.keyword
  FROM content_plan_items AS cpi
  WHERE 
    -- Match on post title with case insensitivity
    LOWER(TRIM(cpo.post_title)) = LOWER(TRIM(cpi.post_title)) AND
    cpo.content_plan_guid = cpi.content_plan_id AND
    -- Only update if keyword is null or empty
    (cpo.keyword IS NULL OR cpo.keyword = '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the backfill function to update existing data
SELECT backfill_outline_keywords();

-- Check specific outline that wasn't updating
SELECT o.guid, o.post_title, o.keyword AS outline_keyword, 
       i.post_title AS item_post_title, i.keyword AS item_keyword
FROM content_plan_outlines o
LEFT JOIN content_plan_items i ON 
  o.content_plan_guid = i.content_plan_id AND 
  LOWER(TRIM(o.post_title)) = LOWER(TRIM(i.post_title))
WHERE o.post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively'
OR i.post_title = 'Online Reputation Repair: Restore Your Brand Image Fast and Effectively';