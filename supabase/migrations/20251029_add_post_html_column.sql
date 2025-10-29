-- Add post_html column to tasks table for storing rendered HTML
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS post_html TEXT;

COMMENT ON COLUMN tasks.post_html IS 'Rendered HTML output from post_json, ready for publishing';

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✅ Added post_html column to tasks table';
END;
$$;
