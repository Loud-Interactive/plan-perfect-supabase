-- Function to process batch URLs atomically
CREATE OR REPLACE FUNCTION process_batch_urls(
  p_batch_id UUID,
  p_urls TEXT[],
  p_user_id UUID
)
RETURNS TABLE(
  url TEXT,
  page_id UUID,
  job_id UUID,
  job_created BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url TEXT;
  v_domain TEXT;
  v_path TEXT;
  v_page_id UUID;
  v_job_id UUID;
  v_existing_job_id UUID;
BEGIN
  -- Process each URL
  FOREACH v_url IN ARRAY p_urls LOOP
    BEGIN
      -- Extract domain and path
      v_domain := substring(v_url from 'https?://([^/]+)');
      v_path := substring(v_url from 'https?://[^/]+(.*)');
      IF v_path = '' THEN v_path := '/'; END IF;
      
      -- Create or get page
      INSERT INTO pages (domain, path)
      VALUES (v_domain, v_path)
      ON CONFLICT (domain, path) 
      DO UPDATE SET updated_at = NOW()
      RETURNING id INTO v_page_id;
      
      -- Check for existing crawl job
      SELECT id INTO v_existing_job_id
      FROM crawl_jobs
      WHERE page_id = v_page_id
      AND (status = 'pending' OR status = 'processing')
      LIMIT 1;
      
      IF v_existing_job_id IS NOT NULL THEN
        -- Job already exists
        RETURN QUERY SELECT 
          v_url,
          v_page_id,
          v_existing_job_id,
          false,
          NULL::TEXT;
      ELSE
        -- Create new crawl job
        INSERT INTO crawl_jobs (
          page_id,
          status,
          batch_id,
          pp_batch_id,
          created_at,
          updated_at
        ) VALUES (
          v_page_id,
          'pending',
          gen_random_uuid(), -- Generate a batch_id if needed
          p_batch_id,
          NOW(),
          NOW()
        )
        RETURNING id INTO v_job_id;
        
        -- Add user job association
        INSERT INTO pp_user_jobs (user_id, job_id)
        VALUES (p_user_id, v_job_id)
        ON CONFLICT DO NOTHING;
        
        -- Trigger the workflow (non-blocking)
        PERFORM pg_notify(
          'seo_workflow_trigger',
          json_build_object(
            'job_id', v_job_id,
            'page_id', v_page_id,
            'url', v_url,
            'pp_batch_id', p_batch_id
          )::text
        );
        
        RETURN QUERY SELECT 
          v_url,
          v_page_id,
          v_job_id,
          true,
          NULL::TEXT;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- Return error for this URL
      RETURN QUERY SELECT 
        v_url,
        NULL::UUID,
        NULL::UUID,
        false,
        SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_batch_urls(UUID, TEXT[], UUID) TO authenticated;

-- Function to update batch progress atomically
CREATE OR REPLACE FUNCTION update_batch_progress(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER;
  v_completed INTEGER;
  v_failed INTEGER;
BEGIN
  -- Get counts from seo_processing_tracking
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE success = true AND processing_end IS NOT NULL),
    COUNT(*) FILTER (WHERE success = false AND processing_end IS NOT NULL)
  INTO v_total, v_completed, v_failed
  FROM seo_processing_tracking
  WHERE pp_batch_id = p_batch_id;
  
  -- Update batch job
  UPDATE pp_batch_jobs
  SET 
    processed_urls = v_completed,
    failed_urls = v_failed,
    status = CASE
      WHEN v_total = 0 THEN 'processing'
      WHEN v_completed + v_failed >= total_urls THEN 'completed'
      ELSE 'processing'
    END,
    completed_at = CASE
      WHEN v_completed + v_failed >= total_urls THEN NOW()
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE id = p_batch_id;
  
  -- Update progress table
  INSERT INTO pp_batch_progress (batch_id, stage, completed, failed, in_progress, updated_at)
  VALUES (
    p_batch_id,
    'overall',
    v_completed,
    v_failed,
    v_total - v_completed - v_failed,
    NOW()
  )
  ON CONFLICT (batch_id, stage) 
  DO UPDATE SET
    completed = EXCLUDED.completed,
    failed = EXCLUDED.failed,
    in_progress = EXCLUDED.in_progress,
    updated_at = NOW();
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_batch_progress(UUID) TO authenticated;

-- Trigger to update batch progress when tracking records change
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

-- Create trigger
DROP TRIGGER IF EXISTS update_batch_progress_trigger ON seo_processing_tracking;
CREATE TRIGGER update_batch_progress_trigger
AFTER INSERT OR UPDATE ON seo_processing_tracking
FOR EACH ROW
EXECUTE FUNCTION trigger_update_batch_progress();

-- Add pp_user_jobs table if it doesn't exist
CREATE TABLE IF NOT EXISTS pp_user_jobs (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, job_id)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_pp_user_jobs_user_id ON pp_user_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_pp_user_jobs_job_id ON pp_user_jobs(job_id);

-- RLS policies for pp_user_jobs
ALTER TABLE pp_user_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own job associations"
ON pp_user_jobs FOR SELECT
USING (auth.uid() = user_id);

-- Comment
COMMENT ON FUNCTION process_batch_urls IS 'Atomically processes batch URLs, creating pages and jobs with proper error handling';
COMMENT ON FUNCTION update_batch_progress IS 'Updates batch progress counts atomically to avoid race conditions';