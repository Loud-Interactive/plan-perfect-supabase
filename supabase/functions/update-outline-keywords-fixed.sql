-- Drop existing triggers and function
DROP TRIGGER IF EXISTS update_outline_keywords_on_items_insert ON content_plan_items;
DROP TRIGGER IF EXISTS update_outline_keywords_on_items_update ON content_plan_items;
DROP FUNCTION IF EXISTS update_outline_keywords();

-- Create a new function that updates the keyword when a new outline is created
CREATE OR REPLACE FUNCTION update_outline_keywords_on_creation()
RETURNS TRIGGER AS $$
DECLARE
  updated_keyword TEXT;
BEGIN
  -- Only proceed if the keyword is null or empty
  IF NEW.keyword IS NULL OR NEW.keyword = '' THEN
    -- Look for a matching content_plan_item and update the keyword
    UPDATE content_plan_outlines
    SET keyword = (
      SELECT keyword
      FROM content_plan_items
      WHERE 
        LOWER(TRIM(post_title)) = LOWER(TRIM(NEW.post_title)) 
        AND content_plan_id = NEW.content_plan_guid
      LIMIT 1
    )
    WHERE guid = NEW.guid
    RETURNING keyword INTO updated_keyword;
    
    -- Log if we found a keyword
    IF updated_keyword IS NOT NULL AND updated_keyword != '' THEN
      RAISE NOTICE 'Updated outline % with keyword: %', NEW.guid, updated_keyword;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger that runs after a new outline is inserted
CREATE TRIGGER update_outline_keywords_on_creation
AFTER INSERT ON content_plan_outlines
FOR EACH ROW
EXECUTE FUNCTION update_outline_keywords_on_creation();

-- Also create a trigger that runs after an outline title is updated
CREATE TRIGGER update_outline_keywords_on_title_update
AFTER UPDATE OF post_title ON content_plan_outlines
FOR EACH ROW
WHEN (OLD.post_title IS DISTINCT FROM NEW.post_title)
EXECUTE FUNCTION update_outline_keywords_on_creation();

-- Keep the backfill function for existing data
DROP FUNCTION IF EXISTS backfill_outline_keywords();

CREATE OR REPLACE FUNCTION backfill_outline_keywords()
RETURNS void AS $$
BEGIN
  -- Update content_plan_outlines with keywords from content_plan_items when post_title matches
  UPDATE content_plan_outlines AS cpo
  SET keyword = (
    SELECT keyword
    FROM content_plan_items AS cpi
    WHERE 
      LOWER(TRIM(cpi.post_title)) = LOWER(TRIM(cpo.post_title))
      AND cpi.content_plan_id = cpo.content_plan_guid
    LIMIT 1
  )
  WHERE 
    (cpo.keyword IS NULL OR cpo.keyword = '')
    AND EXISTS (
      SELECT 1
      FROM content_plan_items AS cpi
      WHERE 
        LOWER(TRIM(cpi.post_title)) = LOWER(TRIM(cpo.post_title))
        AND cpi.content_plan_id = cpo.content_plan_guid
    );
    
  RAISE NOTICE 'Backfill complete - updated keywords in content_plan_outlines';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the backfill function for existing data
SELECT backfill_outline_keywords();