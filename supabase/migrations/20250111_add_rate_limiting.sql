-- Create rate limiting table for batch submissions
CREATE TABLE IF NOT EXISTS pp_rate_limits (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_start)
);

-- Create index for efficient cleanup
CREATE INDEX idx_pp_rate_limits_window_start ON pp_rate_limits(window_start);

-- Function to check rate limits
CREATE OR REPLACE FUNCTION check_batch_rate_limit(
  p_user_id UUID,
  p_max_requests INTEGER DEFAULT 10,
  p_window_minutes INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
  v_allowed BOOLEAN;
BEGIN
  -- Calculate window start
  v_window_start := date_trunc('hour', NOW());
  
  -- Get current count and increment atomically
  INSERT INTO pp_rate_limits (user_id, window_start, request_count)
  VALUES (p_user_id, v_window_start, 1)
  ON CONFLICT (user_id, window_start)
  DO UPDATE SET request_count = pp_rate_limits.request_count + 1
  RETURNING request_count INTO v_current_count;
  
  -- Check if within limits
  v_allowed := v_current_count <= p_max_requests;
  
  -- Log rate limit violations
  IF NOT v_allowed THEN
    INSERT INTO system_alerts (alert_type, message, metadata)
    VALUES (
      'rate_limit_exceeded',
      format('User %s exceeded rate limit', p_user_id),
      jsonb_build_object(
        'user_id', p_user_id,
        'request_count', v_current_count,
        'limit', p_max_requests,
        'window_start', v_window_start
      )
    );
  END IF;
  
  RETURN v_allowed;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_batch_rate_limit(UUID, INTEGER, INTEGER) TO authenticated;

-- Cleanup old rate limit records (runs daily)
SELECT cron.schedule(
  'pp-rate-limit-cleanup',
  '0 3 * * *', -- Daily at 3 AM
  $$
  DELETE FROM pp_rate_limits 
  WHERE window_start < NOW() - INTERVAL '7 days';
  $$
);

-- Add batch size limits
ALTER TABLE pp_batch_jobs
ADD CONSTRAINT check_batch_size 
CHECK (total_urls <= 10000);

-- Create function to validate batch submission
CREATE OR REPLACE FUNCTION validate_batch_submission(
  p_user_id UUID,
  p_url_count INTEGER
)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check rate limit
  IF NOT check_batch_rate_limit(p_user_id, 10, 60) THEN
    RETURN QUERY SELECT false, 'Rate limit exceeded. Maximum 10 batches per hour.';
    RETURN;
  END IF;
  
  -- Check batch size
  IF p_url_count > 10000 THEN
    RETURN QUERY SELECT false, 'Batch size exceeds maximum of 10,000 URLs.';
    RETURN;
  END IF;
  
  -- Check concurrent batches
  IF EXISTS (
    SELECT 1 FROM pp_batch_jobs 
    WHERE user_id = p_user_id 
    AND status = 'processing'
    HAVING COUNT(*) >= 3
  ) THEN
    RETURN QUERY SELECT false, 'Maximum 3 concurrent batches allowed.';
    RETURN;
  END IF;
  
  -- All checks passed
  RETURN QUERY SELECT true, 'Batch submission allowed.';
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION validate_batch_submission(UUID, INTEGER) TO authenticated;