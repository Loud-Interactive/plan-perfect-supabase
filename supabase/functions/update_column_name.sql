-- Rename column in table if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'page_perfect_url_status'
        AND column_name = 'error_message'
    ) THEN
        ALTER TABLE page_perfect_url_status RENAME COLUMN error_message TO "errorMessage";
    END IF;
END $$;

-- Verify the column was renamed properly
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'page_perfect_url_status'
ORDER BY ordinal_position;