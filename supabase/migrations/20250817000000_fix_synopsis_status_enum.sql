-- Fix synopsis status enum type issue
-- Convert TEXT status columns to proper enum types

-- Create the enum types if they don't exist
DO $$ 
BEGIN
  -- Create synopsis_jobs_status enum type
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synopsis_jobs_status') THEN
    CREATE TYPE synopsis_jobs_status AS ENUM (
      'pending', 
      'processing', 
      'completed', 
      'failed',
      'discovering_pages',
      'pages_discovered',
      'crawling_pages',
      'pages_crawled',
      'ready_for_analysis',
      'finalizing'
    );
  END IF;

  -- Create synopsis_page_tasks_status enum type
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synopsis_page_tasks_status') THEN
    CREATE TYPE synopsis_page_tasks_status AS ENUM (
      'pending', 
      'processing', 
      'completed', 
      'failed'
    );
  END IF;

  -- Create synopsis_analysis_tasks_status enum type
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synopsis_analysis_tasks_status') THEN
    CREATE TYPE synopsis_analysis_tasks_status AS ENUM (
      'pending', 
      'processing', 
      'completed', 
      'failed'
    );
  END IF;
END $$;

-- Now we need to migrate the existing TEXT columns to use the enum types
-- This is a bit complex because we can't directly alter column type from TEXT to ENUM

-- 1. Rename the old columns
ALTER TABLE synopsis_jobs RENAME COLUMN status TO status_old;
ALTER TABLE synopsis_page_tasks RENAME COLUMN status TO status_old;
ALTER TABLE synopsis_analysis_tasks RENAME COLUMN status TO status_old;

-- 2. Add new columns with enum type
ALTER TABLE synopsis_jobs ADD COLUMN status synopsis_jobs_status;
ALTER TABLE synopsis_page_tasks ADD COLUMN status synopsis_page_tasks_status;
ALTER TABLE synopsis_analysis_tasks ADD COLUMN status synopsis_analysis_tasks_status;

-- 3. Copy data from old columns to new columns
UPDATE synopsis_jobs SET status = status_old::synopsis_jobs_status WHERE status_old IN ('pending', 'processing', 'completed', 'failed');
UPDATE synopsis_jobs SET status = 'pending' WHERE status IS NULL;

UPDATE synopsis_page_tasks SET status = status_old::synopsis_page_tasks_status;
UPDATE synopsis_analysis_tasks SET status = status_old::synopsis_analysis_tasks_status;

-- 4. Set NOT NULL constraint
ALTER TABLE synopsis_jobs ALTER COLUMN status SET NOT NULL;
ALTER TABLE synopsis_page_tasks ALTER COLUMN status SET NOT NULL;
ALTER TABLE synopsis_analysis_tasks ALTER COLUMN status SET NOT NULL;

-- 5. Set default values
ALTER TABLE synopsis_jobs ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE synopsis_page_tasks ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE synopsis_analysis_tasks ALTER COLUMN status SET DEFAULT 'pending';

-- 6. Drop the old columns
ALTER TABLE synopsis_jobs DROP COLUMN status_old;
ALTER TABLE synopsis_page_tasks DROP COLUMN status_old;
ALTER TABLE synopsis_analysis_tasks DROP COLUMN status_old;

-- 7. Recreate indexes on the new columns
CREATE INDEX IF NOT EXISTS idx_synopsis_jobs_status ON synopsis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_synopsis_page_tasks_status ON synopsis_page_tasks(status);
CREATE INDEX IF NOT EXISTS idx_synopsis_analysis_tasks_status ON synopsis_analysis_tasks(status);

-- Add comment for documentation
COMMENT ON TYPE synopsis_jobs_status IS 'Enum type for synopsis job status values';
COMMENT ON TYPE synopsis_page_tasks_status IS 'Enum type for synopsis page task status values';
COMMENT ON TYPE synopsis_analysis_tasks_status IS 'Enum type for synopsis analysis task status values';