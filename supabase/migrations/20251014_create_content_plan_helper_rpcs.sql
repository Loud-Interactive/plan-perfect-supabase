-- Helper RPC functions for content_plans queries - TEXT columns
-- Needed because Supabase JS client sends TEXT parameters that can't be compared with UUID columns

-- Get content plan by guid
CREATE OR REPLACE FUNCTION get_content_plan_by_guid(p_guid TEXT)
RETURNS TABLE (
  guid UUID,
  domain_name TEXT,
  keyword TEXT,
  content_plan JSONB,
  content_plan_table TEXT,
  "timestamp" TIMESTAMPTZ,  -- Quote reserved keyword
  enhanced_analysis JSONB,
  semantic_clusters JSONB,
  content_strategy JSONB,
  status TEXT,
  error_message TEXT,
  email TEXT,
  is_deleted BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cp.guid,
    cp.domain_name,
    cp.keyword,
    cp.content_plan,
    cp.content_plan_table,
    cp."timestamp",  -- Quote reserved keyword
    cp.enhanced_analysis,
    cp.semantic_clusters,
    cp.content_strategy,
    cp.status,
    cp.error_message,
    cp.email,
    cp.is_deleted
  FROM content_plans cp
  WHERE cp.guid = p_guid;
END;
$$;

-- Get content plans by domain
CREATE OR REPLACE FUNCTION get_content_plans_by_domain(p_domain TEXT)
RETURNS TABLE (
  guid UUID,
  domain_name TEXT,
  keyword TEXT,
  status TEXT,
  "timestamp" TIMESTAMPTZ  -- Quote reserved keyword
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cp.guid,
    cp.domain_name,
    cp.keyword,
    cp.status,
    cp."timestamp"  -- Quote reserved keyword
  FROM content_plans cp
  WHERE cp.domain_name = p_domain
  ORDER BY cp."timestamp" DESC;  -- Quote reserved keyword
END;
$$;

-- Update content plan status by guid (renamed to avoid conflict with trigger function)
CREATE OR REPLACE FUNCTION update_content_plan_by_guid(
  p_guid TEXT,
  p_status TEXT,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INT;
BEGIN
  UPDATE content_plans SET
    status = p_status,
    error_message = p_error_message,
    "timestamp" = now()  -- Quote reserved keyword
  WHERE guid = p_guid;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected > 0;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_content_plan_by_guid TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_content_plans_by_domain TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_content_plan_by_guid TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_content_plan_by_guid IS 'Get content plan by guid - TEXT columns, no casting needed';
COMMENT ON FUNCTION get_content_plans_by_domain IS 'Get all content plans for a domain';
COMMENT ON FUNCTION update_content_plan_by_guid IS 'Update content plan status - TEXT columns, no casting needed';
