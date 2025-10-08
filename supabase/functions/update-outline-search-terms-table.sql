-- Update outline_search_terms table structure to add category and priority fields
DO $$
BEGIN
  -- Add category column if it doesn't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_terms' AND column_name = 'category'
  ) THEN
    ALTER TABLE outline_search_terms ADD COLUMN category TEXT DEFAULT 'generic';
  END IF;
  
  -- Add priority column if it doesn't exist
  IF NOT EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_terms' AND column_name = 'priority'
  ) THEN
    ALTER TABLE outline_search_terms ADD COLUMN priority INTEGER DEFAULT 5;
  END IF;
END $$;

-- Add comments to document the purpose of columns
-- Only add these if the columns exist (to avoid errors)
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_terms' AND column_name = 'category'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_terms.category IS ''Classification of search term (base, combined, titleAngle, relatedConcept, fallback)''';
  END IF;
  
  IF EXISTS (
    SELECT FROM information_schema.columns 
    WHERE table_name = 'outline_search_terms' AND column_name = 'priority'
  ) THEN
    EXECUTE 'COMMENT ON COLUMN outline_search_terms.priority IS ''Priority level for search term (1=highest, 5=lowest)''';
  END IF;
END $$;