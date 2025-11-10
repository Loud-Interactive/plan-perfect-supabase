-- Migration: Add retry tracking columns to outline_generation_jobs for fast outline generation
-- This enables automatic retry logic for failed fast outline generation (search, analysis, and regeneration)

ALTER TABLE public.outline_generation_jobs
  ADD COLUMN IF NOT EXISTS fast_regeneration_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fast_regeneration_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fast_search_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fast_search_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fast_generation_retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fast_generation_retry_at TIMESTAMPTZ;

COMMENT ON COLUMN public.outline_generation_jobs.fast_regeneration_retry_count IS 'Number of retry attempts for fast regeneration (max 3)';
COMMENT ON COLUMN public.outline_generation_jobs.fast_regeneration_retry_at IS 'Timestamp when the next regeneration retry should be attempted';
COMMENT ON COLUMN public.outline_generation_jobs.fast_search_retry_count IS 'Number of retry attempts for fast search (max 3)';
COMMENT ON COLUMN public.outline_generation_jobs.fast_search_retry_at IS 'Timestamp when the next search retry should be attempted';
COMMENT ON COLUMN public.outline_generation_jobs.fast_generation_retry_count IS 'Number of retry attempts for fast generation/analysis (max 3)';
COMMENT ON COLUMN public.outline_generation_jobs.fast_generation_retry_at IS 'Timestamp when the next generation retry should be attempted';

-- Create indexes for finding jobs that need retry
CREATE INDEX IF NOT EXISTS outline_generation_jobs_regeneration_retry_idx 
  ON public.outline_generation_jobs (status, fast_regeneration_retry_at)
  WHERE status = 'fast_regeneration_failed' AND fast_regeneration_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS outline_generation_jobs_search_retry_idx 
  ON public.outline_generation_jobs (status, fast_search_retry_at)
  WHERE status = 'failed' AND fast_search_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS outline_generation_jobs_generation_retry_idx 
  ON public.outline_generation_jobs (status, fast_generation_retry_at)
  WHERE status = 'failed' AND fast_generation_retry_at IS NOT NULL;

