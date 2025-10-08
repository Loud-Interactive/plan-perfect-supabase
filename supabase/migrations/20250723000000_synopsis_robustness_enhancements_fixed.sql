-- Synopsis Perfect Robustness Enhancements (Fixed)
-- Adds columns and tables for resilient profile generation

-- Enhanced synopsis_jobs table
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS min_required_pages INTEGER DEFAULT 5;
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS quality_score DECIMAL;
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS partial_completion_allowed BOOLEAN DEFAULT true;
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 5;
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS retry_strategy TEXT DEFAULT 'exponential';
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS checkpoint_data JSONB;
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS last_checkpoint_at TIMESTAMPTZ;
ALTER TABLE synopsis_jobs ADD COLUMN IF NOT EXISTS partial_status TEXT CHECK (partial_status IN ('none', 'minimal', 'basic', 'enhanced', 'complete'));

-- Enhanced synopsis_page_tasks table
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10);
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false;
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS fallback_urls TEXT[];
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS scraping_method TEXT DEFAULT 'scraperapi';
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0;
ALTER TABLE synopsis_page_tasks ADD COLUMN IF NOT EXISTS skip_if_failed BOOLEAN DEFAULT false;

-- Enhanced synopsis_analysis_tasks table
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT true;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS depends_on TEXT[];
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS fallback_prompt TEXT;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS min_confidence_score DECIMAL;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS partial_response TEXT;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10);

-- New table for tracking API quotas and health
CREATE TABLE IF NOT EXISTS synopsis_api_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name TEXT NOT NULL UNIQUE,
  is_healthy BOOLEAN DEFAULT true,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  consecutive_failures INTEGER DEFAULT 0,
  circuit_breaker_state TEXT DEFAULT 'closed' CHECK (circuit_breaker_state IN ('closed', 'open', 'half-open')),
  circuit_breaker_opens_at INTEGER DEFAULT 5, -- failures before opening
  circuit_breaker_cooldown_ms INTEGER DEFAULT 300000, -- 5 minutes default
  daily_quota_limit INTEGER,
  daily_quota_used INTEGER DEFAULT 0,
  quota_reset_at TIMESTAMPTZ,
  average_response_time_ms INTEGER,
  total_requests INTEGER DEFAULT 0,
  total_failures INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT synopsis_api_health_failures_check CHECK (consecutive_failures >= 0),
  CONSTRAINT synopsis_api_health_quota_check CHECK (daily_quota_used >= 0)
);

-- Initialize API health records with service-specific configurations
INSERT INTO synopsis_api_health (api_name, daily_quota_limit, circuit_breaker_opens_at, circuit_breaker_cooldown_ms) VALUES
  ('scraperapi', 1000, 3, 180000),      -- 3 failures, 3 minute cooldown
  ('openai', 10000, 5, 300000),         -- 5 failures, 5 minute cooldown
  ('deepseek', 5000, 4, 240000),        -- 4 failures, 4 minute cooldown
  ('playwright', 999999, 2, 120000),    -- 2 failures, 2 minute cooldown
  ('puppeteer', 999999, 2, 120000),     -- 2 failures, 2 minute cooldown
  ('fetch', 999999, 10, 60000),         -- 10 failures, 1 minute cooldown
  ('archive', 999999, 5, 300000)        -- 5 failures, 5 minute cooldown
ON CONFLICT (api_name) DO NOTHING;

-- New table for job recovery history
CREATE TABLE IF NOT EXISTS synopsis_recovery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES synopsis_jobs(id) ON DELETE CASCADE,
  recovery_type TEXT NOT NULL, -- 'checkpoint', 'partial', 'fallback'
  stage_before TEXT,
  stage_after TEXT,
  recovery_metadata JSONB,
  success BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for recovery log
CREATE INDEX IF NOT EXISTS idx_synopsis_recovery_job_id ON synopsis_recovery_log(job_id);
CREATE INDEX IF NOT EXISTS idx_synopsis_recovery_created_at ON synopsis_recovery_log(created_at);

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_synopsis_jobs_checkpoint ON synopsis_jobs(last_checkpoint_at) WHERE checkpoint_data IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_synopsis_jobs_quality ON synopsis_jobs(quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_synopsis_jobs_partial_status ON synopsis_jobs(partial_status) WHERE partial_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_synopsis_page_tasks_priority ON synopsis_page_tasks(priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_synopsis_page_tasks_critical ON synopsis_page_tasks(is_critical) WHERE is_critical = true;
CREATE INDEX IF NOT EXISTS idx_synopsis_page_tasks_failures ON synopsis_page_tasks(consecutive_failures) WHERE consecutive_failures > 0;

CREATE INDEX IF NOT EXISTS idx_synopsis_analysis_tasks_priority ON synopsis_analysis_tasks(priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_synopsis_analysis_tasks_required ON synopsis_analysis_tasks(is_required) WHERE is_required = true;
CREATE INDEX IF NOT EXISTS idx_synopsis_analysis_tasks_partial ON synopsis_analysis_tasks(job_id) WHERE partial_response IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_synopsis_api_health_state ON synopsis_api_health(api_name, circuit_breaker_state);
CREATE INDEX IF NOT EXISTS idx_synopsis_api_health_quota ON synopsis_api_health(api_name, daily_quota_used);

-- Update trigger for synopsis_api_health
CREATE TRIGGER update_synopsis_api_health_updated_at 
  BEFORE UPDATE ON synopsis_api_health 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to reset daily quotas
CREATE OR REPLACE FUNCTION reset_api_quotas() RETURNS void AS $$
BEGIN
  UPDATE synopsis_api_health
  SET 
    daily_quota_used = 0,
    quota_reset_at = NOW() + INTERVAL '1 day'
  WHERE quota_reset_at IS NULL OR quota_reset_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to get API availability
CREATE OR REPLACE FUNCTION is_api_available(p_api_name TEXT) RETURNS BOOLEAN AS $$
DECLARE
  v_health synopsis_api_health%ROWTYPE;
  v_time_since_failure INTERVAL;
BEGIN
  SELECT * INTO v_health 
  FROM synopsis_api_health 
  WHERE api_name = p_api_name;
  
  IF NOT FOUND THEN
    RETURN TRUE; -- Unknown API is considered available
  END IF;
  
  -- Check circuit breaker
  IF v_health.circuit_breaker_state = 'open' THEN
    v_time_since_failure := NOW() - v_health.last_failure_at;
    IF EXTRACT(EPOCH FROM v_time_since_failure) * 1000 < v_health.circuit_breaker_cooldown_ms THEN
      RETURN FALSE;
    END IF;
  END IF;
  
  -- Check quota
  IF v_health.daily_quota_limit IS NOT NULL THEN
    -- Reset quota if needed
    IF v_health.quota_reset_at IS NULL OR v_health.quota_reset_at < NOW() THEN
      PERFORM reset_api_quotas();
      RETURN TRUE;
    END IF;
    
    -- Check if quota exceeded (with 5% buffer)
    IF v_health.daily_quota_used >= v_health.daily_quota_limit * 0.95 THEN
      RETURN FALSE;
    END IF;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to record API usage
CREATE OR REPLACE FUNCTION record_api_usage(
  p_api_name TEXT,
  p_success BOOLEAN,
  p_response_time_ms INTEGER DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_health synopsis_api_health%ROWTYPE;
  v_new_failures INTEGER;
  v_new_state TEXT;
BEGIN
  SELECT * INTO v_health 
  FROM synopsis_api_health 
  WHERE api_name = p_api_name
  FOR UPDATE;
  
  IF NOT FOUND THEN
    -- Create new record for unknown API
    INSERT INTO synopsis_api_health (api_name) VALUES (p_api_name);
    SELECT * INTO v_health FROM synopsis_api_health WHERE api_name = p_api_name;
  END IF;
  
  IF p_success THEN
    -- Record success
    UPDATE synopsis_api_health
    SET 
      is_healthy = TRUE,
      last_success_at = NOW(),
      consecutive_failures = 0,
      circuit_breaker_state = 'closed',
      daily_quota_used = COALESCE(daily_quota_used, 0) + 1,
      total_requests = COALESCE(total_requests, 0) + 1,
      average_response_time_ms = CASE
        WHEN average_response_time_ms IS NULL OR total_requests = 0 THEN p_response_time_ms
        WHEN p_response_time_ms IS NOT NULL THEN 
          ((average_response_time_ms * total_requests) + p_response_time_ms) / (total_requests + 1)
        ELSE average_response_time_ms
      END,
      updated_at = NOW()
    WHERE api_name = p_api_name;
  ELSE
    -- Record failure
    v_new_failures := v_health.consecutive_failures + 1;
    v_new_state := v_health.circuit_breaker_state;
    
    -- Check if circuit breaker should open
    IF v_new_failures >= v_health.circuit_breaker_opens_at THEN
      v_new_state := 'open';
    END IF;
    
    UPDATE synopsis_api_health
    SET 
      is_healthy = (v_new_state != 'open'),
      last_failure_at = NOW(),
      consecutive_failures = v_new_failures,
      circuit_breaker_state = v_new_state,
      total_requests = COALESCE(total_requests, 0) + 1,
      total_failures = COALESCE(total_failures, 0) + 1,
      updated_at = NOW()
    WHERE api_name = p_api_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get job quality metrics
CREATE OR REPLACE FUNCTION get_job_quality_metrics(p_job_id UUID) 
RETURNS TABLE (
  profile_stage TEXT,
  quality_score DECIMAL,
  pages_completed INTEGER,
  pages_total INTEGER,
  analyses_completed INTEGER,
  analyses_total INTEGER,
  is_viable BOOLEAN
) AS $$
DECLARE
  v_completed_analyses TEXT[];
  v_quality_score DECIMAL;
  v_stage TEXT;
BEGIN
  -- Get completed analyses
  SELECT ARRAY_AGG(DISTINCT analysis_type) INTO v_completed_analyses
  FROM synopsis_analysis_tasks
  WHERE job_id = p_job_id AND status = 'completed';
  
  -- Calculate quality score (simplified version)
  v_quality_score := COALESCE(ARRAY_LENGTH(v_completed_analyses, 1), 0)::DECIMAL / 17;
  
  -- Determine profile stage
  IF ARRAY_LENGTH(v_completed_analyses, 1) >= 17 THEN
    v_stage := 'complete';
  ELSIF ARRAY_LENGTH(v_completed_analyses, 1) >= 7 THEN
    v_stage := 'enhanced';
  ELSIF ARRAY_LENGTH(v_completed_analyses, 1) >= 4 THEN
    v_stage := 'basic';
  ELSIF ARRAY_LENGTH(v_completed_analyses, 1) >= 2 THEN
    v_stage := 'minimal';
  ELSE
    v_stage := 'none';
  END IF;
  
  RETURN QUERY
  SELECT 
    v_stage,
    v_quality_score,
    COUNT(*)::INTEGER FILTER (WHERE pt.status = 'completed'),
    COUNT(*)::INTEGER,
    COALESCE(ARRAY_LENGTH(v_completed_analyses, 1), 0),
    17,
    (v_stage IN ('basic', 'enhanced', 'complete') AND v_quality_score >= 0.4)
  FROM synopsis_page_tasks pt
  WHERE pt.job_id = p_job_id;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON COLUMN synopsis_jobs.min_required_pages IS 'Minimum pages required for viable profile';
COMMENT ON COLUMN synopsis_jobs.quality_score IS 'Overall profile quality score (0-1)';
COMMENT ON COLUMN synopsis_jobs.partial_completion_allowed IS 'Whether to allow partial profile completion';
COMMENT ON COLUMN synopsis_jobs.checkpoint_data IS 'Checkpoint data for job resumption';
COMMENT ON COLUMN synopsis_jobs.partial_status IS 'Profile completeness stage';

COMMENT ON COLUMN synopsis_page_tasks.priority IS 'Task priority (1-10, higher = more important)';
COMMENT ON COLUMN synopsis_page_tasks.is_critical IS 'Whether this page is critical for minimum viable profile';
COMMENT ON COLUMN synopsis_page_tasks.fallback_urls IS 'Alternative URLs to try if primary fails';
COMMENT ON COLUMN synopsis_page_tasks.scraping_method IS 'Method used to scrape this page';

COMMENT ON COLUMN synopsis_analysis_tasks.is_required IS 'Whether this analysis is required for profile completion';
COMMENT ON COLUMN synopsis_analysis_tasks.depends_on IS 'Other analyses this task depends on';
COMMENT ON COLUMN synopsis_analysis_tasks.partial_response IS 'Partial response saved if analysis fails';
COMMENT ON COLUMN synopsis_analysis_tasks.model_used IS 'LLM model used for this analysis';

COMMENT ON TABLE synopsis_api_health IS 'Tracks API health, quotas, and circuit breaker states';
COMMENT ON TABLE synopsis_recovery_log IS 'Logs job recovery attempts and outcomes';