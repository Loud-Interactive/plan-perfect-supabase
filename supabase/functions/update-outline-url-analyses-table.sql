-- Add summary column to outline_url_analyses table
ALTER TABLE outline_url_analyses
ADD COLUMN IF NOT EXISTS summary TEXT;

-- Add comment to document the purpose
COMMENT ON COLUMN outline_url_analyses.summary IS 'Stores a brief summary of the article content from analysis';