-- Minimal version - just add the column without indexes
-- Indexes can be added later during low-traffic periods

-- Add column if it doesn't exist
ALTER TABLE crawl_jobs 
ADD COLUMN IF NOT EXISTS pp_batch_id UUID;

-- Add comment
COMMENT ON COLUMN crawl_jobs.pp_batch_id IS 'Reference to PagePerfect batch job for bulk processing';

-- Note: Foreign key and indexes can be added later with:
-- ALTER TABLE crawl_jobs ADD CONSTRAINT fk_crawl_jobs_pp_batch_id FOREIGN KEY (pp_batch_id) REFERENCES pp_batch_jobs(id) ON DELETE SET NULL;
-- CREATE INDEX CONCURRENTLY idx_crawl_jobs_pp_batch_id ON crawl_jobs(pp_batch_id) WHERE pp_batch_id IS NOT NULL;