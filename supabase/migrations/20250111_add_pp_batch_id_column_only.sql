-- Add pp_batch_id column to crawl_jobs table (minimal version)
-- This is a lightweight migration that just adds the column

-- Add column if it doesn't exist (without foreign key for speed)
ALTER TABLE crawl_jobs 
ADD COLUMN IF NOT EXISTS pp_batch_id UUID;

-- Add comment
COMMENT ON COLUMN crawl_jobs.pp_batch_id IS 'Reference to PagePerfect batch job for bulk processing';

-- Note: You can add the foreign key constraint later with:
-- ALTER TABLE crawl_jobs ADD CONSTRAINT fk_crawl_jobs_pp_batch_id FOREIGN KEY (pp_batch_id) REFERENCES pp_batch_jobs(id) ON DELETE SET NULL;