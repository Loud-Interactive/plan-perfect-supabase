-- Check if the RPC function exists and what its signature is
SELECT
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'upsert_content_plan_outline'
AND n.nspname = 'public';

-- If it doesn't exist, create it
CREATE OR REPLACE FUNCTION public.upsert_content_plan_outline(
  p_guid TEXT,
  p_content_plan_guid TEXT,
  p_post_title TEXT,
  p_domain TEXT,
  p_keyword TEXT,
  p_outline TEXT,
  p_status TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cast TEXT parameters to UUID and upsert
  INSERT INTO public.content_plan_outlines (
    guid,
    content_plan_guid,
    post_title,
    domain,
    keyword,
    outline,
    status,
    updated_at
  ) VALUES (
    p_guid::uuid,
    CASE
      WHEN p_content_plan_guid IS NULL OR p_content_plan_guid = ''
      THEN NULL
      ELSE p_content_plan_guid::uuid
    END,
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
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.upsert_content_plan_outline TO anon, authenticated, service_role;