-- Create a simple RPC function to save outlines without UUID comparison issues
CREATE OR REPLACE FUNCTION save_outline(
  p_guid TEXT,
  p_content_plan_guid TEXT,
  p_post_title TEXT,
  p_domain TEXT,
  p_keyword TEXT,
  p_outline TEXT,
  p_status TEXT DEFAULT 'completed'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check if record exists by casting TEXT to UUID
  SELECT EXISTS(
    SELECT 1 FROM content_plan_outlines
    WHERE guid = p_guid::uuid
  ) INTO v_exists;

  IF v_exists THEN
    -- Update existing record
    UPDATE content_plan_outlines SET
      content_plan_guid = CASE
        WHEN p_content_plan_guid IS NULL OR p_content_plan_guid = '' THEN NULL
        ELSE p_content_plan_guid::uuid
      END,
      post_title = p_post_title,
      domain = p_domain,
      keyword = p_keyword,
      outline = p_outline,
      status = p_status,
      updated_at = now()
    WHERE guid = p_guid::uuid;
  ELSE
    -- Insert new record
    INSERT INTO content_plan_outlines (
      guid,
      content_plan_guid,
      post_title,
      domain,
      keyword,
      outline,
      status,
      created_at,
      updated_at
    ) VALUES (
      p_guid::uuid,
      CASE
        WHEN p_content_plan_guid IS NULL OR p_content_plan_guid = '' THEN NULL
        ELSE p_content_plan_guid::uuid
      END,
      p_post_title,
      p_domain,
      p_keyword,
      p_outline,
      p_status,
      now(),
      now()
    );
  END IF;

  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  -- Log the error but don't fail
  RAISE WARNING 'Error saving outline: %', SQLERRM;
  RETURN FALSE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION save_outline TO anon, authenticated, service_role;

COMMENT ON FUNCTION save_outline IS 'Saves outline to content_plan_outlines table with proper UUID casting';