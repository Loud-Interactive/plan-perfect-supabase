-- Synopsis Perfect Reliability Improvements
-- Implements event-driven architecture with automatic phase transitions

-- 1. Enhanced Job States
DO $$ 
BEGIN
  -- Add new status values if they don't exist
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'discovering_pages' AND enumtypid = 'synopsis_jobs_status'::regtype) THEN
    ALTER TYPE synopsis_jobs_status ADD VALUE 'discovering_pages';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pages_discovered' AND enumtypid = 'synopsis_jobs_status'::regtype) THEN
    ALTER TYPE synopsis_jobs_status ADD VALUE 'pages_discovered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'crawling_pages' AND enumtypid = 'synopsis_jobs_status'::regtype) THEN
    ALTER TYPE synopsis_jobs_status ADD VALUE 'crawling_pages';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pages_crawled' AND enumtypid = 'synopsis_jobs_status'::regtype) THEN
    ALTER TYPE synopsis_jobs_status ADD VALUE 'pages_crawled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ready_for_analysis' AND enumtypid = 'synopsis_jobs_status'::regtype) THEN
    ALTER TYPE synopsis_jobs_status ADD VALUE 'ready_for_analysis';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'finalizing' AND enumtypid = 'synopsis_jobs_status'::regtype) THEN
    ALTER TYPE synopsis_jobs_status ADD VALUE 'finalizing';
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- Type doesn't exist, skip
    NULL;
END $$;

-- Add progress tracking columns to synopsis_jobs
ALTER TABLE synopsis_jobs 
ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Add chunking support to analysis tasks
ALTER TABLE synopsis_analysis_tasks 
ADD COLUMN IF NOT EXISTS chunk_id INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER,
ADD COLUMN IF NOT EXISTS error_details JSONB;

-- Create index for efficient chunk processing
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_chunk_status 
ON synopsis_analysis_tasks(job_id, chunk_id, status);

-- 2. Event Queue Table
CREATE TABLE IF NOT EXISTS synopsis_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES synopsis_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'phase_complete', 'start_crawling', 'start_analysis', 
    'ready_to_finalize', 'retry_needed', 'error', 'heartbeat'
  )),
  event_data JSONB DEFAULT '{}',
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  process_after TIMESTAMPTZ DEFAULT NOW(), -- For delayed processing
  error_count INTEGER DEFAULT 0,
  last_error TEXT
);

-- Indexes for efficient event processing
CREATE INDEX IF NOT EXISTS idx_synopsis_events_unprocessed 
ON synopsis_events(process_after, processed) 
WHERE processed = FALSE;

CREATE INDEX IF NOT EXISTS idx_synopsis_events_job 
ON synopsis_events(job_id, created_at DESC);

-- 3. Function to safely transition job status
CREATE OR REPLACE FUNCTION transition_job_status(
  p_job_id UUID,
  p_new_status TEXT,
  p_expected_status TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  IF p_expected_status IS NOT NULL THEN
    UPDATE synopsis_jobs
    SET status = p_new_status::synopsis_jobs_status,
        phase_started_at = NOW(),
        last_heartbeat = NOW(),
        updated_at = NOW()
    WHERE id = p_job_id
    AND status = p_expected_status::synopsis_jobs_status;
  ELSE
    UPDATE synopsis_jobs
    SET status = p_new_status::synopsis_jobs_status,
        phase_started_at = NOW(),
        last_heartbeat = NOW(),
        updated_at = NOW()
    WHERE id = p_job_id;
  END IF;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger: Auto-start page discovery after job creation
CREATE OR REPLACE FUNCTION auto_start_page_discovery()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    -- Schedule page discovery to start in 2 seconds
    INSERT INTO synopsis_events (job_id, event_type, event_data, process_after)
    VALUES (
      NEW.id, 
      'start_crawling', 
      jsonb_build_object(
        'domain', NEW.domain,
        'trigger', 'job_created'
      ),
      NOW() + INTERVAL '2 seconds'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_page_discovery ON synopsis_jobs;
CREATE TRIGGER trigger_auto_page_discovery
AFTER INSERT ON synopsis_jobs
FOR EACH ROW
EXECUTE FUNCTION auto_start_page_discovery();

-- 5. Trigger: Monitor page crawling completion
CREATE OR REPLACE FUNCTION check_crawling_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_job RECORD;
  v_actual_completed INTEGER;
BEGIN
  -- Only process on task completion
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Get job info
    SELECT * INTO v_job FROM synopsis_jobs WHERE id = NEW.job_id;
    
    -- Count actual completed tasks
    SELECT COUNT(*) INTO v_actual_completed
    FROM synopsis_page_tasks
    WHERE job_id = NEW.job_id AND status = 'completed';
    
    -- Update completed count
    UPDATE synopsis_jobs 
    SET completed_pages = v_actual_completed,
        last_heartbeat = NOW()
    WHERE id = NEW.job_id;
    
    -- Check if all pages are done
    IF v_actual_completed >= v_job.total_pages AND v_job.total_pages > 0 THEN
      -- Transition to pages_crawled
      IF transition_job_status(NEW.job_id, 'pages_crawled', 'crawling_pages') THEN
        -- Create event to start analysis
        INSERT INTO synopsis_events (job_id, event_type, event_data)
        VALUES (
          NEW.job_id, 
          'start_analysis', 
          jsonb_build_object(
            'pages_completed', v_actual_completed,
            'trigger', 'all_pages_crawled'
          )
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_crawling_complete ON synopsis_page_tasks;
CREATE TRIGGER trigger_check_crawling_complete
AFTER UPDATE ON synopsis_page_tasks
FOR EACH ROW
EXECUTE FUNCTION check_crawling_complete();

-- 6. Trigger: Monitor analysis progress
CREATE OR REPLACE FUNCTION check_analysis_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_total INTEGER;
  v_completed INTEGER;
  v_failed INTEGER;
  v_min_viable INTEGER := 8; -- Minimum analyses for viable profile
BEGIN
  IF NEW.status IN ('completed', 'failed') AND OLD.status NOT IN ('completed', 'failed') THEN
    -- Count analysis progress
    SELECT 
      COUNT(*),
      COUNT(*) FILTER (WHERE status = 'completed'),
      COUNT(*) FILTER (WHERE status = 'failed')
    INTO v_total, v_completed, v_failed
    FROM synopsis_analysis_tasks
    WHERE job_id = NEW.job_id;
    
    -- Update heartbeat
    UPDATE synopsis_jobs 
    SET last_heartbeat = NOW()
    WHERE id = NEW.job_id;
    
    -- Check if we should finalize
    IF v_completed >= v_min_viable OR (v_completed + v_failed = v_total AND v_completed > 0) THEN
      -- We have enough analyses or all are done
      INSERT INTO synopsis_events (job_id, event_type, event_data)
      VALUES (
        NEW.job_id,
        'ready_to_finalize',
        jsonb_build_object(
          'completed_analyses', v_completed,
          'failed_analyses', v_failed,
          'total_analyses', v_total,
          'trigger', CASE 
            WHEN v_completed >= v_min_viable THEN 'min_viable_reached'
            ELSE 'all_analyses_done'
          END
        )
      )
      ON CONFLICT DO NOTHING; -- Prevent duplicate events
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_analysis_progress ON synopsis_analysis_tasks;
CREATE TRIGGER trigger_check_analysis_progress
AFTER UPDATE ON synopsis_analysis_tasks
FOR EACH ROW
EXECUTE FUNCTION check_analysis_progress();

-- 7. Function to create chunked analysis tasks
CREATE OR REPLACE FUNCTION create_analysis_chunks(
  p_job_id UUID,
  p_chunk_size INTEGER DEFAULT 3
) RETURNS INTEGER AS $$
DECLARE
  v_analysis_types TEXT[] := ARRAY[
    'company_overview',
    'services_products', 
    'target_audience',
    'brand_voice',
    'key_differentiators',
    'pain_points_addressed',
    'content_themes',
    'brand_personality',
    'unique_value_propositions',
    'customer_benefits',
    'industry_focus',
    'geographical_focus',
    'pricing_strategy',
    'competitive_advantages',
    'sustainability_initiatives',
    'innovation_approach',
    'partnership_ecosystem'
  ];
  v_chunk_id INTEGER := 1;
  v_task_count INTEGER := 0;
  i INTEGER;
BEGIN
  -- Delete any existing analysis tasks for this job
  DELETE FROM synopsis_analysis_tasks WHERE job_id = p_job_id;
  
  -- Create tasks in chunks
  FOR i IN 1..array_length(v_analysis_types, 1) LOOP
    INSERT INTO synopsis_analysis_tasks (
      job_id, 
      analysis_type, 
      chunk_id, 
      status,
      created_at
    ) VALUES (
      p_job_id,
      v_analysis_types[i],
      v_chunk_id,
      'pending',
      NOW()
    );
    
    v_task_count := v_task_count + 1;
    
    -- Move to next chunk after chunk_size items
    IF i % p_chunk_size = 0 THEN
      v_chunk_id := v_chunk_id + 1;
    END IF;
  END LOOP;
  
  RETURN v_task_count;
END;
$$ LANGUAGE plpgsql;

-- 8. Heartbeat update function
CREATE OR REPLACE FUNCTION update_job_heartbeat(p_job_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE synopsis_jobs 
  SET last_heartbeat = NOW()
  WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql;

-- 9. Progress monitoring view
CREATE OR REPLACE VIEW synopsis_job_progress AS
SELECT 
  j.id,
  j.domain,
  j.status,
  j.created_at,
  j.phase_started_at,
  j.last_heartbeat,
  EXTRACT(EPOCH FROM (NOW() - j.phase_started_at))::INTEGER as phase_duration_seconds,
  EXTRACT(EPOCH FROM (NOW() - j.last_heartbeat))::INTEGER as seconds_since_heartbeat,
  j.completed_pages || '/' || j.total_pages as page_progress,
  COUNT(DISTINCT at.id) FILTER (WHERE at.status = 'completed') || '/' || 
    COUNT(DISTINCT at.id) as analysis_progress,
  COUNT(DISTINCT at.chunk_id) as total_chunks,
  CASE 
    WHEN j.last_heartbeat < NOW() - INTERVAL '10 minutes' THEN 'dead'
    WHEN j.last_heartbeat < NOW() - INTERVAL '5 minutes' THEN 'stale'
    WHEN j.last_heartbeat < NOW() - INTERVAL '2 minutes' THEN 'warning'
    ELSE 'healthy'
  END as health_status,
  j.retry_count,
  j.error_message
FROM synopsis_jobs j
LEFT JOIN synopsis_analysis_tasks at ON at.job_id = j.id
WHERE j.created_at > NOW() - INTERVAL '24 hours' -- Only show recent jobs
GROUP BY j.id
ORDER BY j.created_at DESC;

-- 10. Cleanup function for old events
CREATE OR REPLACE FUNCTION cleanup_old_synopsis_data()
RETURNS VOID AS $$
BEGIN
  -- Delete processed events older than 1 day
  DELETE FROM synopsis_events 
  WHERE processed = TRUE 
  AND processed_at < NOW() - INTERVAL '1 day';
  
  -- Delete failed jobs older than 7 days
  DELETE FROM synopsis_jobs
  WHERE status IN ('failed', 'partially_completed')
  AND updated_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT ALL ON synopsis_events TO postgres, anon, authenticated, service_role;
GRANT ALL ON synopsis_job_progress TO postgres, anon, authenticated, service_role;