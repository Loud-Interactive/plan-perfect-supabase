-- Function to update keywords in content_plan_outlines from matching content_plan_items
CREATE OR REPLACE FUNCTION update_outline_keywords()
RETURNS TRIGGER AS $$
BEGIN
  -- Update content_plan_outlines with keywords from content_plan_items when post_title matches
  UPDATE content_plan_outlines AS cpo
  SET keyword = cpi.keyword
  FROM content_plan_items AS cpi
  WHERE 
    -- Match on post title (exact match) and content plan relationship
    cpo.post_title = cpi.post_title AND
    cpo.content_plan_guid = cpi.content_plan_id AND
    -- Only update if keyword is null or empty
    (cpo.keyword IS NULL OR cpo.keyword = '');
  
  RETURN NULL; -- for AFTER triggers
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger to automatically run this function after inserting items
CREATE OR REPLACE TRIGGER update_outline_keywords_on_items_insert
AFTER INSERT ON content_plan_items
FOR EACH STATEMENT
EXECUTE FUNCTION update_outline_keywords();

-- Create a trigger to automatically run this function after updating items
CREATE OR REPLACE TRIGGER update_outline_keywords_on_items_update
AFTER UPDATE ON content_plan_items
FOR EACH STATEMENT
EXECUTE FUNCTION update_outline_keywords();

-- Also create a backfill function to run once for existing data
CREATE OR REPLACE FUNCTION backfill_outline_keywords()
RETURNS void AS $$
BEGIN
  -- Update content_plan_outlines with keywords from content_plan_items when post_title matches
  UPDATE content_plan_outlines AS cpo
  SET keyword = cpi.keyword
  FROM content_plan_items AS cpi
  WHERE 
    -- Match on post title (exact match) and content plan relationship
    cpo.post_title = cpi.post_title AND
    cpo.content_plan_guid = cpi.content_plan_id AND
    -- Only update if keyword is null or empty
    (cpo.keyword IS NULL OR cpo.keyword = '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Commented out to prevent automatic execution - run this manually
-- SELECT backfill_outline_keywords();