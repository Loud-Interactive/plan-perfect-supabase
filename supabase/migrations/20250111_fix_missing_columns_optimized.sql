-- Fix missing columns with optimized approach for large tables
-- Run each statement separately if needed

-- 1. First, add the column without the foreign key constraint (much faster)
ALTER TABLE crawl_jobs 
ADD COLUMN IF NOT EXISTS pp_batch_id UUID;

-- 2. Add the foreign key constraint separately (can be done without locking the entire table)
ALTER TABLE crawl_jobs
ADD CONSTRAINT fk_crawl_jobs_pp_batch_id 
FOREIGN KEY (pp_batch_id) 
REFERENCES pp_batch_jobs(id) 
ON DELETE SET NULL
NOT VALID;

-- 3. Validate the constraint in the background (non-blocking)
ALTER TABLE crawl_jobs 
VALIDATE CONSTRAINT fk_crawl_jobs_pp_batch_id;

-- 4. Create indexes CONCURRENTLY to avoid locking
-- Note: CONCURRENTLY cannot be used inside a transaction, so run these separately
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crawl_jobs_pp_batch_id 
ON crawl_jobs(pp_batch_id) 
WHERE pp_batch_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crawl_jobs_page_id 
ON crawl_jobs(page_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seo_processing_tracking_job_id 
ON seo_processing_tracking(job_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pp_batch_jobs_user_id 
ON pp_batch_jobs(user_id);

-- 5. Add comment (fast operation)
COMMENT ON COLUMN crawl_jobs.pp_batch_id IS 'Reference to PagePerfect batch job for bulk processing';