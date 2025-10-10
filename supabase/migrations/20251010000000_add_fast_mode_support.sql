-- Migration: Add fast mode support to outline generation system
-- Created: 2025-10-10
-- Description: Adds fast_mode flag and rich data columns for Groq-powered fast outline generation

-- Add fast_mode flag to outline_generation_jobs
ALTER TABLE outline_generation_jobs
ADD COLUMN IF NOT EXISTS fast_mode BOOLEAN DEFAULT FALSE;

-- Add columns to outline_search_results for rich data from Groq
ALTER TABLE outline_search_results
ADD COLUMN IF NOT EXISTS headings_array JSONB,
ADD COLUMN IF NOT EXISTS quotes_array JSONB;

-- Add index for efficient querying of fast mode results
CREATE INDEX IF NOT EXISTS idx_outline_search_results_job_fast
ON outline_search_results(job_id, search_category)
WHERE search_category = 'fast';

-- Add comment to document the schema
COMMENT ON COLUMN outline_generation_jobs.fast_mode IS 'When true, uses Groq gpt-oss-120b with browser_search tool for faster outline generation';
COMMENT ON COLUMN outline_search_results.headings_array IS 'Array of heading strings extracted from article (e.g., ["# Title", "## Section", "### Subsection"])';
COMMENT ON COLUMN outline_search_results.quotes_array IS 'Array of quote objects with text and citation URL (e.g., [{"text": "...", "citation": "https://..."}])';
