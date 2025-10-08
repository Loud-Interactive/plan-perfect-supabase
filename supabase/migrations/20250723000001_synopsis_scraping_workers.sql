-- Synopsis Perfect Parallel Scraping - Worker Management Tables

-- Table to track scraping worker status and performance
CREATE TABLE IF NOT EXISTS synopsis_scraping_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES synopsis_jobs(id) ON DELETE CASCADE,
  worker_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'scraping', 'failed', 'completed')),
  current_task_id UUID REFERENCES synopsis_page_tasks(id),
  current_url TEXT,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  total_response_time_ms BIGINT DEFAULT 0,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT synopsis_scraping_workers_unique_job_worker UNIQUE (job_id, worker_number),
  CONSTRAINT synopsis_scraping_workers_counts_check CHECK (
    tasks_completed >= 0 AND 
    tasks_failed >= 0 AND 
    total_response_time_ms >= 0
  )
);

-- Table to track scraping performance metrics
CREATE TABLE IF NOT EXISTS synopsis_scraping_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES synopsis_jobs(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  active_workers INTEGER DEFAULT 0,
  queue_depth INTEGER DEFAULT 0,
  pages_per_second DECIMAL,
  average_response_time_ms INTEGER,
  success_rate DECIMAL,
  api_health_score DECIMAL,
  config JSONB, -- Current scraping configuration
  
  -- Constraints
  CONSTRAINT synopsis_scraping_metrics_check CHECK (
    active_workers >= 0 AND
    queue_depth >= 0 AND
    pages_per_second >= 0 AND
    average_response_time_ms >= 0 AND
    success_rate BETWEEN 0 AND 1 AND
    api_health_score BETWEEN 0 AND 1
  )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_synopsis_scraping_workers_job_id ON synopsis_scraping_workers(job_id);
CREATE INDEX IF NOT EXISTS idx_synopsis_scraping_workers_status ON synopsis_scraping_workers(status);
CREATE INDEX IF NOT EXISTS idx_synopsis_scraping_workers_heartbeat ON synopsis_scraping_workers(last_heartbeat);

CREATE INDEX IF NOT EXISTS idx_synopsis_scraping_metrics_job_id ON synopsis_scraping_metrics(job_id);
CREATE INDEX IF NOT EXISTS idx_synopsis_scraping_metrics_timestamp ON synopsis_scraping_metrics(timestamp DESC);

-- Update trigger for workers table
CREATE TRIGGER update_synopsis_scraping_workers_updated_at 
  BEFORE UPDATE ON synopsis_scraping_workers 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get current scraping status
CREATE OR REPLACE FUNCTION get_scraping_status(p_job_id UUID)
RETURNS TABLE (
  total_workers INTEGER,
  active_workers INTEGER,
  idle_workers INTEGER,
  tasks_completed INTEGER,
  tasks_failed INTEGER,
  average_tasks_per_worker DECIMAL,
  average_response_time_ms INTEGER,
  success_rate DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH worker_stats AS (
    SELECT 
      COUNT(*) AS total_workers,
      COUNT(*) FILTER (WHERE status = 'scraping') AS active_workers,
      COUNT(*) FILTER (WHERE status = 'idle') AS idle_workers,
      SUM(tasks_completed) AS total_completed,
      SUM(tasks_failed) AS total_failed,
      SUM(total_response_time_ms) AS total_response_time,
      SUM(tasks_completed + tasks_failed) AS total_tasks
    FROM synopsis_scraping_workers
    WHERE job_id = p_job_id
  )
  SELECT 
    total_workers::INTEGER,
    active_workers::INTEGER,
    idle_workers::INTEGER,
    COALESCE(total_completed, 0)::INTEGER,
    COALESCE(total_failed, 0)::INTEGER,
    CASE 
      WHEN total_workers > 0 THEN (total_completed::DECIMAL / total_workers)
      ELSE 0
    END AS average_tasks_per_worker,
    CASE 
      WHEN total_completed > 0 THEN (total_response_time / total_completed)::INTEGER
      ELSE 0
    END AS average_response_time_ms,
    CASE 
      WHEN total_tasks > 0 THEN (total_completed::DECIMAL / total_tasks)
      ELSE 0
    END AS success_rate
  FROM worker_stats;
END;
$$ LANGUAGE plpgsql;

-- Function to register/update worker heartbeat
CREATE OR REPLACE FUNCTION update_worker_heartbeat(
  p_job_id UUID,
  p_worker_number INTEGER,
  p_status TEXT DEFAULT 'idle',
  p_current_task_id UUID DEFAULT NULL,
  p_current_url TEXT DEFAULT NULL
) RETURNS void AS $$
BEGIN
  INSERT INTO synopsis_scraping_workers (
    job_id, 
    worker_number, 
    status, 
    current_task_id,
    current_url,
    last_heartbeat
  ) VALUES (
    p_job_id, 
    p_worker_number, 
    p_status, 
    p_current_task_id,
    p_current_url,
    NOW()
  )
  ON CONFLICT (job_id, worker_number) 
  DO UPDATE SET
    status = EXCLUDED.status,
    current_task_id = EXCLUDED.current_task_id,
    current_url = EXCLUDED.current_url,
    last_heartbeat = NOW(),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to record worker task completion
CREATE OR REPLACE FUNCTION record_worker_task_completion(
  p_job_id UUID,
  p_worker_number INTEGER,
  p_success BOOLEAN,
  p_response_time_ms INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE synopsis_scraping_workers
  SET 
    tasks_completed = tasks_completed + CASE WHEN p_success THEN 1 ELSE 0 END,
    tasks_failed = tasks_failed + CASE WHEN p_success THEN 0 ELSE 1 END,
    total_response_time_ms = total_response_time_ms + COALESCE(p_response_time_ms, 0),
    current_task_id = NULL,
    current_url = NULL,
    status = 'idle',
    last_heartbeat = NOW(),
    updated_at = NOW()
  WHERE job_id = p_job_id AND worker_number = p_worker_number;
END;
$$ LANGUAGE plpgsql;

-- Function to detect stale workers (no heartbeat for 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_workers() RETURNS void AS $$
BEGIN
  UPDATE synopsis_scraping_workers
  SET 
    status = 'failed',
    error_message = 'Worker became unresponsive',
    completed_at = NOW()
  WHERE 
    status IN ('scraping', 'idle') AND
    last_heartbeat < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE synopsis_scraping_workers IS 'Tracks individual worker status for parallel scraping';
COMMENT ON TABLE synopsis_scraping_metrics IS 'Performance metrics for scraping operations';

COMMENT ON COLUMN synopsis_scraping_workers.worker_number IS 'Worker identifier within a job (0-based)';
COMMENT ON COLUMN synopsis_scraping_workers.total_response_time_ms IS 'Cumulative response time for performance tracking';
COMMENT ON COLUMN synopsis_scraping_workers.last_heartbeat IS 'Last time worker reported activity';

COMMENT ON COLUMN synopsis_scraping_metrics.pages_per_second IS 'Current scraping throughput';
COMMENT ON COLUMN synopsis_scraping_metrics.api_health_score IS 'Combined health score of all scraping APIs (0-1)';
COMMENT ON COLUMN synopsis_scraping_metrics.config IS 'Scraping configuration used at this timestamp';