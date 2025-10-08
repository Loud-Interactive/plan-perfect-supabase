-- Create the outline_search_queue table for progressive search processing
CREATE TABLE IF NOT EXISTS outline_search_queue (
  id SERIAL PRIMARY KEY,
  job_id UUID REFERENCES outline_generation_jobs(id),
  search_term TEXT NOT NULL,
  category TEXT,
  priority INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  result_count INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_outline_search_queue_job_id ON outline_search_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_outline_search_queue_status ON outline_search_queue(status);
CREATE INDEX IF NOT EXISTS idx_outline_search_queue_priority ON outline_search_queue(priority);

-- Add comments to document purpose
COMMENT ON TABLE outline_search_queue IS 'Stores search terms queue for progressive processing to avoid timeouts';