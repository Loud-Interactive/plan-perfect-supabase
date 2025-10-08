-- PagePerfect 2.0 Batch Management Tables
-- This migration creates the necessary tables for managing large-scale URL batch processing

-- Master batch tracking table
CREATE TABLE IF NOT EXISTS pp_batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_urls INTEGER NOT NULL DEFAULT 0,
  processed_urls INTEGER NOT NULL DEFAULT 0,
  failed_urls INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Indexes for performance
  CONSTRAINT valid_url_counts CHECK (
    total_urls >= 0 AND 
    processed_urls >= 0 AND 
    failed_urls >= 0 AND
    processed_urls + failed_urls <= total_urls
  )
);

-- Create indexes for common queries
CREATE INDEX idx_pp_batch_jobs_user_id ON pp_batch_jobs(user_id);
CREATE INDEX idx_pp_batch_jobs_status ON pp_batch_jobs(status);
CREATE INDEX idx_pp_batch_jobs_created_at ON pp_batch_jobs(created_at DESC);

-- Add batch tracking to existing seo_processing_tracking table
ALTER TABLE seo_processing_tracking 
ADD COLUMN IF NOT EXISTS pp_batch_id UUID REFERENCES pp_batch_jobs(id) ON DELETE CASCADE;

-- Create index for batch queries
CREATE INDEX IF NOT EXISTS idx_seo_processing_tracking_pp_batch_id 
ON seo_processing_tracking(pp_batch_id) 
WHERE pp_batch_id IS NOT NULL;

-- Real-time progress tracking table
CREATE TABLE IF NOT EXISTS pp_batch_progress (
  batch_id UUID REFERENCES pp_batch_jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('crawling', 'gsc_data', 'seo_analysis', 'seo_generation', 'completed', 'failed')),
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  in_progress INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (batch_id, stage),
  CONSTRAINT valid_counts CHECK (
    completed >= 0 AND 
    failed >= 0 AND 
    in_progress >= 0
  )
);

-- Create index for real-time queries
CREATE INDEX idx_pp_batch_progress_updated_at ON pp_batch_progress(updated_at DESC);

-- Enable Row Level Security
ALTER TABLE pp_batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pp_batch_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pp_batch_jobs
-- Users can only see their own batches
CREATE POLICY "Users can view own batches" ON pp_batch_jobs
  FOR SELECT USING (auth.uid() = user_id);

-- Users can create their own batches  
CREATE POLICY "Users can create own batches" ON pp_batch_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own batches (for cancellation)
CREATE POLICY "Users can update own batches" ON pp_batch_jobs
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to batches" ON pp_batch_jobs
  FOR ALL USING (auth.role() = 'service_role');

-- RLS Policies for pp_batch_progress
-- Users can view progress for their batches
CREATE POLICY "Users can view progress for own batches" ON pp_batch_progress
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM pp_batch_jobs 
      WHERE pp_batch_jobs.id = pp_batch_progress.batch_id 
      AND pp_batch_jobs.user_id = auth.uid()
    )
  );

-- Service role has full access
CREATE POLICY "Service role has full access to progress" ON pp_batch_progress
  FOR ALL USING (auth.role() = 'service_role');

-- Function to update batch job stats (called by triggers or pg_cron)
CREATE OR REPLACE FUNCTION update_batch_job_stats(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_processed INTEGER;
  v_failed INTEGER;
  v_total INTEGER;
  v_all_complete BOOLEAN;
BEGIN
  -- Get counts from seo_processing_tracking
  SELECT 
    COUNT(*) FILTER (WHERE success = true),
    COUNT(*) FILTER (WHERE success = false),
    COUNT(*)
  INTO v_processed, v_failed, v_total
  FROM seo_processing_tracking
  WHERE pp_batch_id = p_batch_id;
  
  -- Check if all jobs are complete
  SELECT NOT EXISTS (
    SELECT 1 
    FROM seo_processing_tracking 
    WHERE pp_batch_id = p_batch_id 
    AND processing_end IS NULL
  ) INTO v_all_complete;
  
  -- Update batch job
  UPDATE pp_batch_jobs
  SET 
    processed_urls = v_processed,
    failed_urls = v_failed,
    status = CASE 
      WHEN v_all_complete AND status = 'processing' THEN 'completed'
      ELSE status
    END,
    completed_at = CASE
      WHEN v_all_complete AND status = 'processing' THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_batch_id;
END;
$$;

-- Function to update batch progress
CREATE OR REPLACE FUNCTION update_batch_progress(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Update progress for different stages based on seo_processing_tracking
  INSERT INTO pp_batch_progress (batch_id, stage, completed, failed, in_progress, updated_at)
  SELECT 
    p_batch_id,
    CASE 
      WHEN processing_end IS NULL THEN 'in_progress'
      WHEN success = true THEN 'completed'
      ELSE 'failed'
    END as stage,
    COUNT(*) FILTER (WHERE success = true AND processing_end IS NOT NULL) as completed,
    COUNT(*) FILTER (WHERE success = false AND processing_end IS NOT NULL) as failed,
    COUNT(*) FILTER (WHERE processing_end IS NULL) as in_progress,
    NOW()
  FROM seo_processing_tracking
  WHERE pp_batch_id = p_batch_id
  GROUP BY stage
  ON CONFLICT (batch_id, stage) 
  DO UPDATE SET
    completed = EXCLUDED.completed,
    failed = EXCLUDED.failed,
    in_progress = EXCLUDED.in_progress,
    updated_at = NOW();
    
  -- Also update overall batch stats
  PERFORM update_batch_job_stats(p_batch_id);
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION update_batch_job_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_batch_progress(UUID) TO authenticated;

-- Create trigger to auto-update batch progress when tracking records change
CREATE OR REPLACE FUNCTION trigger_update_batch_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pp_batch_id IS NOT NULL THEN
    PERFORM update_batch_progress(NEW.pp_batch_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_batch_progress_on_tracking_change
AFTER INSERT OR UPDATE ON seo_processing_tracking
FOR EACH ROW
EXECUTE FUNCTION trigger_update_batch_progress();

-- Comments for documentation
COMMENT ON TABLE pp_batch_jobs IS 'Master table for tracking large-scale URL processing batches';
COMMENT ON TABLE pp_batch_progress IS 'Real-time progress tracking for batch processing stages';
COMMENT ON COLUMN pp_batch_jobs.metadata IS 'JSONB field for storing batch configuration, user preferences, etc.';
COMMENT ON COLUMN seo_processing_tracking.pp_batch_id IS 'Links individual SEO processing jobs to their parent batch';