-- Schema updates to support enhanced PagePerfect batch processing

-- Modify the page_perfect_url_status table to include page_id reference
ALTER TABLE page_perfect_url_status 
ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES pages(id);

-- Create a composite index for faster lookups
CREATE INDEX IF NOT EXISTS idx_url_status_batch_page_id
ON page_perfect_url_status(batch_id, page_id);

-- Add jsonb column for content analysis results including PagePerfect workflow data
ALTER TABLE page_perfect_url_status
ALTER COLUMN analysis TYPE JSONB USING analysis::JSONB;

-- Create status view for faster batch reporting
CREATE OR REPLACE VIEW pageperfect_batch_status AS
SELECT 
  b.id as batch_id,
  b.client_id,
  b.project_id,
  b.status,
  b.total_urls,
  b.processed_urls,
  b.successful_urls,
  b.failed_urls,
  (
    SELECT COUNT(*) 
    FROM page_perfect_url_status s 
    WHERE s.batch_id = b.id AND s.page_id IS NOT NULL
  ) as pageperfect_processed,
  b.created_at,
  b.updated_at
FROM page_perfect_batches b;

-- Create function to calculate completeness percentage
CREATE OR REPLACE FUNCTION get_batch_completion_percentage(batch_id UUID)
RETURNS numeric AS $$
DECLARE
  total numeric;
  processed numeric;
BEGIN
  SELECT total_urls, processed_urls INTO total, processed
  FROM page_perfect_batches
  WHERE id = batch_id;
  
  IF total = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND((processed / total) * 100, 2);
END;
$$ LANGUAGE plpgsql;