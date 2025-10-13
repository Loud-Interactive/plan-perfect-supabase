-- Create RPC function to upsert content_plan_outlines with proper UUID casting
-- This is needed because job_id is TEXT but guid column is UUID

CREATE OR REPLACE FUNCTION upsert_content_plan_outline(
  p_guid TEXT,
  p_content_plan_guid UUID,
  p_post_title TEXT,
  p_domain TEXT,
  p_keyword TEXT,
  p_outline TEXT,
  p_status TEXT
)
RETURNS void AS $$
BEGIN
  -- Cast TEXT guid to UUID and upsert
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
    p_guid::uuid,  -- Cast TEXT to UUID
    p_content_plan_guid,
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
'Upserts content_plan_outline record with proper TEXT to UUID casting for guid parameter';
