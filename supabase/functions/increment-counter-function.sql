-- This is a simple function to increment a counter
-- Used for maintaining retry counts in crawl_jobs
CREATE OR REPLACE FUNCTION increment_counter(row_id UUID)
RETURNS INTEGER AS $$
DECLARE
  current_count INTEGER := 0;
BEGIN
  -- Get the current retry_count for the row
  SELECT COALESCE(retry_count, 0) INTO current_count
  FROM crawl_jobs
  WHERE id = row_id;
  
  -- Return the incremented value
  RETURN current_count + 1;
END;
$$ LANGUAGE plpgsql;