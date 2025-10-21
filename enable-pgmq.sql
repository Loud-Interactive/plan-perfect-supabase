-- Enable pgmq extension
-- Run this in Supabase SQL Editor before running content_jobs migration

CREATE EXTENSION IF NOT EXISTS pgmq CASCADE;

-- Verify it's installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'pgmq';

