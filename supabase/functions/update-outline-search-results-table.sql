-- Update outline_search_results table structure
-- Rename snippet column to description if it exists
DO $$
BEGIN
  -- Handle snippet/description column
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'snippet'
  ) THEN
    ALTER TABLE outline_search_results RENAME COLUMN snippet TO description;
  ELSE
    -- Add description column if neither exists
    IF NOT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'outline_search_results' AND column_name = 'description'
    ) THEN
      ALTER TABLE outline_search_results ADD COLUMN description TEXT;
    END IF;
  END IF;
  
  -- Add date columns if they don't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'publishedTime'
  ) THEN
    ALTER TABLE outline_search_results ADD COLUMN "publishedTime" TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'date'
  ) THEN
    ALTER TABLE outline_search_results ADD COLUMN "date" TEXT;
  END IF;
  
  -- Add search category and priority columns
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'search_category'
  ) THEN
    ALTER TABLE outline_search_results ADD COLUMN search_category TEXT;
  END IF;
  
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'search_priority'
  ) THEN
    ALTER TABLE outline_search_results ADD COLUMN search_priority INTEGER;
  END IF;
  
  -- Add content column for storing the full article content
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'content'
  ) THEN
    ALTER TABLE outline_search_results ADD COLUMN content TEXT;
  END IF;
END $$;

-- Add comments to document the purpose of columns (only if columns exist to avoid errors)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'description'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_results.description IS ''Stores the description/snippet of search results from Jina.ai API''';
  END IF;

  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'publishedTime'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_results."publishedTime" IS ''ISO timestamp of when the content was published''';
  END IF;

  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'date'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_results."date" IS ''Human-readable date when the content was published''';
  END IF;

  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'search_category'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_results.search_category IS ''Classification of the search term that yielded this result''';
  END IF;

  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'search_priority'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_results.search_priority IS ''Priority level of the search term that yielded this result''';
  END IF;

  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_results' AND column_name = 'content'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_results.content IS ''The full content of the search result for use in downstream analysis and processing''';
  END IF;
END $$;