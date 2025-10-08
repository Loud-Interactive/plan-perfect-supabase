-- Create tables for PagePerfect batch processing

-- Table for batches
CREATE TABLE page_perfect_batches (
  id UUID PRIMARY KEY,
  client_id TEXT,
  project_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  total_urls INTEGER NOT NULL,
  processed_urls INTEGER NOT NULL DEFAULT 0,
  successful_urls INTEGER NOT NULL DEFAULT 0,
  failed_urls INTEGER NOT NULL DEFAULT 0,
  config JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Table for URL status
CREATE TABLE page_perfect_url_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES page_perfect_batches(id),
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  errorMessage TEXT,
  html TEXT,
  html_length INTEGER,
  analysis JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Create indexes
CREATE INDEX idx_batch_status ON page_perfect_batches(status);
CREATE INDEX idx_url_status_batch_id ON page_perfect_url_status(batch_id);
CREATE INDEX idx_url_status_status ON page_perfect_url_status(status);
CREATE INDEX idx_url_status_updated_at ON page_perfect_url_status(updated_at);

-- Add RLS policies
-- For batches
ALTER TABLE page_perfect_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON page_perfect_batches
  FOR SELECT
  USING (true);

CREATE POLICY "Enable write access for authenticated users" ON page_perfect_batches
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON page_perfect_batches
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- For URL status
ALTER TABLE page_perfect_url_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON page_perfect_url_status
  FOR SELECT
  USING (true);

CREATE POLICY "Enable write access for authenticated users" ON page_perfect_url_status
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON page_perfect_url_status
  FOR UPDATE
  USING (auth.role() = 'authenticated');