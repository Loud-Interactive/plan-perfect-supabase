-- Create Synopsis Perfect Redux Tables
-- These tables support the queue-based synopsis generation system

-- Main jobs table for orchestrating synopsis generation
CREATE TABLE synopsis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  total_pages INTEGER DEFAULT 0,
  completed_pages INTEGER DEFAULT 0,
  guid UUID DEFAULT gen_random_uuid(), -- For linking with pairs table
  regenerate BOOLEAN DEFAULT FALSE,
  
  -- Add constraints
  CONSTRAINT synopsis_jobs_domain_check CHECK (LENGTH(domain) > 0),
  CONSTRAINT synopsis_jobs_pages_check CHECK (completed_pages <= total_pages)
);

-- Page crawl tasks queue
CREATE TABLE synopsis_page_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES synopsis_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  category TEXT,
  importance INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  raw_html TEXT,
  markdown_content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Add constraints
  CONSTRAINT synopsis_page_tasks_url_check CHECK (LENGTH(url) > 0),
  CONSTRAINT synopsis_page_tasks_importance_check CHECK (importance BETWEEN 1 AND 10),
  CONSTRAINT synopsis_page_tasks_retry_check CHECK (retry_count >= 0)
);

-- LLM analysis tasks queue
CREATE TABLE synopsis_analysis_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES synopsis_jobs(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  llm_response TEXT,
  thinking_log TEXT, -- For DeepSeek reasoner output
  raw_content TEXT, -- Input content for the analysis
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Add constraints
  CONSTRAINT synopsis_analysis_tasks_type_check CHECK (LENGTH(analysis_type) > 0),
  CONSTRAINT synopsis_analysis_tasks_retry_check CHECK (retry_count >= 0)
);

-- Indexes for performance
CREATE INDEX idx_synopsis_jobs_domain ON synopsis_jobs(domain);
CREATE INDEX idx_synopsis_jobs_status ON synopsis_jobs(status);
CREATE INDEX idx_synopsis_jobs_created_at ON synopsis_jobs(created_at);

CREATE INDEX idx_synopsis_page_tasks_job_id ON synopsis_page_tasks(job_id);
CREATE INDEX idx_synopsis_page_tasks_status ON synopsis_page_tasks(status);
CREATE INDEX idx_synopsis_page_tasks_url ON synopsis_page_tasks(url);
CREATE INDEX idx_synopsis_page_tasks_created_at ON synopsis_page_tasks(created_at);

CREATE INDEX idx_synopsis_analysis_tasks_job_id ON synopsis_analysis_tasks(job_id);
CREATE INDEX idx_synopsis_analysis_tasks_status ON synopsis_analysis_tasks(status);
CREATE INDEX idx_synopsis_analysis_tasks_type ON synopsis_analysis_tasks(analysis_type);
CREATE INDEX idx_synopsis_analysis_tasks_created_at ON synopsis_analysis_tasks(created_at);

-- Create trigger for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables
CREATE TRIGGER update_synopsis_jobs_updated_at 
    BEFORE UPDATE ON synopsis_jobs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_synopsis_page_tasks_updated_at 
    BEFORE UPDATE ON synopsis_page_tasks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_synopsis_analysis_tasks_updated_at 
    BEFORE UPDATE ON synopsis_analysis_tasks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE synopsis_jobs IS 'Main orchestration table for synopsis generation jobs';
COMMENT ON TABLE synopsis_page_tasks IS 'Queue table for individual page crawling tasks';
COMMENT ON TABLE synopsis_analysis_tasks IS 'Queue table for LLM analysis tasks';

COMMENT ON COLUMN synopsis_jobs.guid IS 'GUID used for linking results to pairs table';
COMMENT ON COLUMN synopsis_jobs.regenerate IS 'Flag indicating if this is a regeneration request';
COMMENT ON COLUMN synopsis_page_tasks.importance IS 'Importance score from 1-10 for page prioritization';
COMMENT ON COLUMN synopsis_analysis_tasks.thinking_log IS 'Raw thinking/reasoning output from DeepSeek model';
COMMENT ON COLUMN synopsis_analysis_tasks.raw_content IS 'Raw input content passed to the LLM for analysis';