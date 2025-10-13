-- Fix RPC function to accept TEXT for ALL UUID parameters and cast them
-- The Supabase JS client passes parameters as JSON, so UUIDs become TEXT strings

DROP FUNCTION IF EXISTS upsert_content_plan_outline(TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION upsert_content_plan_outline(
  p_guid TEXT,
  p_content_plan_guid TEXT,  -- Changed from UUID to TEXT
  p_post_title TEXT,
  p_domain TEXT,
  p_keyword TEXT,
  p_outline TEXT,
  p_status TEXT
)
RETURNS void AS $$
BEGIN
  -- Cast BOTH TEXT parameters to UUID and upsert
  INSERT INTO content_plan_outlines (
    guid,
    content_plan_guid,
    post_title,
    domain,
    keyword,
    outline,
    status,
    updated_at
  ) VALUES (
    p_guid::uuid,              -- Cast TEXT to UUID
    p_content_plan_guid::uuid, -- Cast TEXT to UUID
    p_post_title,
    p_domain,
    p_keyword,
    p_outline,
    p_status,
    now()
  )
  ON CONFLICT (guid) DO UPDATE SET
    content_plan_guid = EXCLUDED.content_plan_guid,
    post_title = EXCLUDED.post_title,
    domain = EXCLUDED.domain,
    keyword = EXCLUDED.keyword,
    outline = EXCLUDED.outline,
    status = EXCLUDED.status,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION upsert_content_plan_outline IS
'Upserts content_plan_outline record with proper TEXT to UUID casting for both guid and content_plan_guid parameters. All parameters are TEXT because Supabase JS client passes them as JSON strings.';
