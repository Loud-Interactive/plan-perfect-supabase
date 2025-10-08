-- Schema updates to support Claude thinking and SEO element generation

-- Create table for storing rewrite thinking logs
CREATE TABLE IF NOT EXISTS rewrite_thinking_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  thinking TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for storing SEO recommendations
CREATE TABLE IF NOT EXISTS page_seo_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  h1 TEXT NOT NULL,
  h2 TEXT NOT NULL,
  paragraph TEXT NOT NULL,
  thinking_log TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (page_id)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_page_seo_recommendations_page_id
ON page_seo_recommendations(page_id);