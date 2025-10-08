-- Simple version of the crawl job table creation script
-- without fancy dynamic checks - use this if the main script fails

-- Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the table (no foreign key)
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url TEXT NOT NULL,
  batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  heartbeat_at TIMESTAMP WITH TIME ZONE,
  error TEXT,
  html TEXT,
  html_length INTEGER,
  page_id UUID,
  premium BOOLEAN DEFAULT FALSE,
  ultra_premium BOOLEAN DEFAULT TRUE,
  render BOOLEAN DEFAULT TRUE,
  success_method TEXT,
  processing_time_ms INTEGER,
  retry_count INTEGER DEFAULT 0
);

-- Create indexes
CREATE INDEX IF NOT EXISTS crawl_jobs_status_idx ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS crawl_jobs_url_idx ON crawl_jobs(url);
CREATE INDEX IF NOT EXISTS crawl_jobs_batch_id_idx ON crawl_jobs(batch_id);

-- Create update timestamp function
CREATE OR REPLACE FUNCTION update_crawl_job_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Try to create the trigger if not exists
DO $$
BEGIN
  -- Check if trigger exists
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger 
    WHERE tgname = 'crawl_job_timestamp'
  ) THEN
    -- Create trigger
    CREATE TRIGGER crawl_job_timestamp
    BEFORE UPDATE ON crawl_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_crawl_job_timestamp();
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Trigger creation failed, but table should still be usable
  RAISE NOTICE 'Could not create trigger: %', SQLERRM;
END $$;