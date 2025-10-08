-- PagePerfect 2.0 pg_cron Jobs
-- This migration creates scheduled jobs for monitoring and managing batch processing

-- Ensure pg_cron extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Monitor stuck jobs and mark them as failed after timeout
SELECT cron.schedule(
  'pp-stuck-job-monitor',
  '*/5 * * * *', -- Every 5 minutes
  $$
  UPDATE seo_processing_tracking
  SET 
    success = false,
    error_message = 'Job timed out after 30 minutes',
    processing_end = NOW(),
    updated_at = NOW()
  WHERE 
    processing_start < NOW() - INTERVAL '30 minutes'
    AND processing_end IS NULL
    AND pp_batch_id IS NOT NULL;
  $$
);

-- Update batch progress statistics
SELECT cron.schedule(
  'pp-batch-progress-updater',
  '* * * * *', -- Every minute
  $$
  INSERT INTO pp_batch_progress (batch_id, stage, completed, failed, in_progress, updated_at)
  SELECT 
    t.pp_batch_id,
    CASE 
      WHEN t.processing_end IS NULL THEN 'processing'
      WHEN t.success = true THEN 'completed'
      ELSE 'failed'
    END as stage,
    COUNT(*) FILTER (WHERE t.success = true AND t.processing_end IS NOT NULL) as completed,
    COUNT(*) FILTER (WHERE t.success = false AND t.processing_end IS NOT NULL) as failed,
    COUNT(*) FILTER (WHERE t.processing_end IS NULL) as in_progress,
    NOW()
  FROM seo_processing_tracking t
  WHERE t.pp_batch_id IS NOT NULL
  GROUP BY t.pp_batch_id, stage
  ON CONFLICT (batch_id, stage) 
  DO UPDATE SET
    completed = EXCLUDED.completed,
    failed = EXCLUDED.failed,
    in_progress = EXCLUDED.in_progress,
    updated_at = NOW();
  $$
);

-- Mark batches as completed when all jobs are done
SELECT cron.schedule(
  'pp-batch-completer',
  '*/2 * * * *', -- Every 2 minutes
  $$
  UPDATE pp_batch_jobs b
  SET 
    status = 'completed',
    completed_at = NOW(),
    processed_urls = (
      SELECT COUNT(*) 
      FROM seo_processing_tracking 
      WHERE pp_batch_id = b.id AND success = true
    ),
    failed_urls = (
      SELECT COUNT(*) 
      FROM seo_processing_tracking 
      WHERE pp_batch_id = b.id AND success = false
    )
  WHERE 
    status = 'processing'
    AND NOT EXISTS (
      SELECT 1 
      FROM seo_processing_tracking 
      WHERE pp_batch_id = b.id 
      AND processing_end IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM seo_processing_tracking
      WHERE pp_batch_id = b.id
    );
  $$
);

-- Clean up old completed batches (optional, keeps last 90 days)
SELECT cron.schedule(
  'pp-batch-cleanup',
  '0 2 * * *', -- Daily at 2 AM
  $$
  -- Archive old batch data before deletion (optional)
  INSERT INTO pp_batch_jobs_archive 
  SELECT * FROM pp_batch_jobs 
  WHERE completed_at < NOW() - INTERVAL '90 days'
  ON CONFLICT DO NOTHING;
  
  -- Delete old completed batches
  DELETE FROM pp_batch_jobs 
  WHERE completed_at < NOW() - INTERVAL '90 days' 
  AND status = 'completed';
  $$
);

-- Monitor overall system health and alert on issues
SELECT cron.schedule(
  'pp-health-monitor',
  '*/10 * * * *', -- Every 10 minutes
  $$
  -- Check for batches stuck in processing for too long
  INSERT INTO system_alerts (alert_type, message, metadata, created_at)
  SELECT 
    'stuck_batch',
    format('Batch %s has been processing for over 2 hours', id),
    jsonb_build_object(
      'batch_id', id,
      'batch_name', name,
      'total_urls', total_urls,
      'processed_urls', processed_urls,
      'created_at', created_at
    ),
    NOW()
  FROM pp_batch_jobs
  WHERE 
    status = 'processing'
    AND created_at < NOW() - INTERVAL '2 hours'
    AND NOT EXISTS (
      SELECT 1 FROM system_alerts 
      WHERE alert_type = 'stuck_batch' 
      AND metadata->>'batch_id' = pp_batch_jobs.id::text
      AND created_at > NOW() - INTERVAL '1 hour'
    );
  $$
);

-- Create system_alerts table if it doesn't exist
CREATE TABLE IF NOT EXISTS system_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for system alerts
CREATE INDEX IF NOT EXISTS idx_system_alerts_created_at ON system_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_alerts_acknowledged ON system_alerts(acknowledged);

-- Create archive table for old batches (optional)
CREATE TABLE IF NOT EXISTS pp_batch_jobs_archive (
  LIKE pp_batch_jobs INCLUDING ALL
);

-- Function to manually trigger batch completion check
CREATE OR REPLACE FUNCTION check_batch_completion(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_all_complete BOOLEAN;
  v_processed INTEGER;
  v_failed INTEGER;
BEGIN
  -- Check if all jobs are complete
  SELECT 
    NOT EXISTS (
      SELECT 1 
      FROM seo_processing_tracking 
      WHERE pp_batch_id = p_batch_id 
      AND processing_end IS NULL
    ),
    COUNT(*) FILTER (WHERE success = true),
    COUNT(*) FILTER (WHERE success = false)
  INTO v_all_complete, v_processed, v_failed
  FROM seo_processing_tracking
  WHERE pp_batch_id = p_batch_id;
  
  -- Update batch if complete
  IF v_all_complete THEN
    UPDATE pp_batch_jobs
    SET 
      status = 'completed',
      completed_at = NOW(),
      processed_urls = v_processed,
      failed_urls = v_failed
    WHERE id = p_batch_id AND status = 'processing';
  END IF;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_batch_completion(UUID) TO authenticated;

-- View to see all scheduled cron jobs
CREATE OR REPLACE VIEW pp_cron_jobs AS
SELECT 
  jobname,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active
FROM cron.job
WHERE jobname LIKE 'pp-%'
ORDER BY jobname;

-- Grant select permission on the view
GRANT SELECT ON pp_cron_jobs TO authenticated;

-- Comments for documentation
COMMENT ON TABLE system_alerts IS 'System-wide alerts for monitoring batch processing health';
COMMENT ON VIEW pp_cron_jobs IS 'View of all PagePerfect cron jobs for monitoring and management';