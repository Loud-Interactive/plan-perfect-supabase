-- Check if the uuid-ossp extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create a crawl job queue table for async processing
DO $$
DECLARE
  table_exists BOOLEAN;
  pages_exists BOOLEAN;
BEGIN
  -- Check if crawl_jobs table already exists
  SELECT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'crawl_jobs'
  ) INTO table_exists;
  
  -- If table doesn't exist, create it
  IF NOT table_exists THEN
    -- Check if pages table exists
    SELECT EXISTS (
      SELECT FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename = 'pages'
    ) INTO pages_exists;
    
    IF pages_exists THEN
      -- Create table with pages reference
      EXECUTE '
        CREATE TABLE crawl_jobs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          url TEXT NOT NULL,
          batch_id TEXT,
          status TEXT NOT NULL DEFAULT ''pending'',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          completed_at TIMESTAMP WITH TIME ZONE,
          heartbeat_at TIMESTAMP WITH TIME ZONE,
          error TEXT,
          html TEXT,
          html_length INTEGER,
          page_id UUID REFERENCES pages(id),
          premium BOOLEAN DEFAULT FALSE,
          ultra_premium BOOLEAN DEFAULT TRUE,
          render BOOLEAN DEFAULT TRUE,
          success_method TEXT,
          processing_time_ms INTEGER,
          retry_count INTEGER DEFAULT 0
        )
      ';
    ELSE
      -- Create table without pages reference
      EXECUTE '
        CREATE TABLE crawl_jobs (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          url TEXT NOT NULL,
          batch_id TEXT,
          status TEXT NOT NULL DEFAULT ''pending'',
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
        )
      ';
    END IF;
    
    -- Create indexes
    EXECUTE 'CREATE INDEX crawl_jobs_status_idx ON crawl_jobs(status)';
    EXECUTE 'CREATE INDEX crawl_jobs_url_idx ON crawl_jobs(url)';
    EXECUTE 'CREATE INDEX crawl_jobs_batch_id_idx ON crawl_jobs(batch_id)';
    
    -- Create update timestamp trigger
    EXECUTE '
      CREATE OR REPLACE FUNCTION update_crawl_job_timestamp()
      RETURNS TRIGGER AS $BODY$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $BODY$ LANGUAGE plpgsql
    ';
    
    EXECUTE '
      CREATE TRIGGER crawl_job_timestamp
      BEFORE UPDATE ON crawl_jobs
      FOR EACH ROW
      EXECUTE PROCEDURE update_crawl_job_timestamp()
    ';
  END IF;
END
$$;