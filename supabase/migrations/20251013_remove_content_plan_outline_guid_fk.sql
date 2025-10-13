-- Remove the foreign key constraint that's causing UUID vs TEXT comparison issues
-- The content_plan_outlines_ai table is for AI history only, and we have job_id FK for integrity

-- Drop the foreign key constraint on content_plan_outline_guid
ALTER TABLE content_plan_outlines_ai
DROP CONSTRAINT IF EXISTS content_plan_outlines_ai_content_plan_outline_guid_fkey;

-- Add a comment explaining why we don't have this FK
COMMENT ON COLUMN content_plan_outlines_ai.content_plan_outline_guid IS
'References content_plan_outlines.guid but FK removed due to UUID/TEXT type mismatch. Use job_id for referential integrity.';
