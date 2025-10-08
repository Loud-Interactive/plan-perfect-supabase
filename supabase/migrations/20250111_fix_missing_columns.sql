-- Fix missing pp_batch_id column in crawl_jobs table
ALTER TABLE crawl_jobs 
ADD COLUMN IF NOT EXISTS pp_batch_id UUID REFERENCES pp_batch_jobs(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_pp_batch_id 
ON crawl_jobs(pp_batch_id) 
WHERE pp_batch_id IS NOT NULL;

-- Add missing indexes for foreign key relationships
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_page_id ON crawl_jobs(page_id);
CREATE INDEX IF NOT EXISTS idx_seo_processing_tracking_job_id ON seo_processing_tracking(job_id);
CREATE INDEX IF NOT EXISTS idx_pp_batch_jobs_user_id ON pp_batch_jobs(user_id);

-- Add comment
COMMENT ON COLUMN crawl_jobs.pp_batch_id IS 'Reference to PagePerfect batch job for bulk processing';