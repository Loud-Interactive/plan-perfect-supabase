-- Drop existing function
DROP FUNCTION IF EXISTS public.get_api_key_info(TEXT);

-- Create function with correct data types matching client_api_keys table
CREATE OR REPLACE FUNCTION public.get_api_key_info(p_domain TEXT)
RETURNS TABLE (
  api_key VARCHAR(64),  -- Match the actual column type
  api_url TEXT,
  site_url TEXT,
  active BOOLEAN,
  monthly_post_limit INTEGER,
  monthly_post_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return the API key and construct WordPress URLs based on the domain
  RETURN QUERY
  SELECT 
    cak.api_key::VARCHAR(64),  -- Explicit cast to match table column type
    ('https://www.' || cak.domain || '/wp-json/wp/v2')::TEXT as api_url,
    ('https://www.' || cak.domain)::TEXT as site_url,
    cak.is_active as active,
    COALESCE(cak.monthly_post_limit, 0)::INTEGER as monthly_post_limit,
    COALESCE(cak.monthly_post_count, 0)::INTEGER as monthly_post_count
  FROM client_api_keys cak
  WHERE cak.domain = p_domain
  AND cak.is_active = true
  LIMIT 1;
  
  -- If not found with exact match, try with www prefix removed/added
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 
      cak.api_key::VARCHAR(64),
      ('https://www.' || cak.domain || '/wp-json/wp/v2')::TEXT as api_url,
      ('https://www.' || cak.domain)::TEXT as site_url,
      cak.is_active as active,
      COALESCE(cak.monthly_post_limit, 0)::INTEGER as monthly_post_limit,
      COALESCE(cak.monthly_post_count, 0)::INTEGER as monthly_post_count
    FROM client_api_keys cak
    WHERE (cak.domain = REPLACE(p_domain, 'www.', '')
    OR cak.domain = 'www.' || p_domain)
    AND cak.is_active = true
    LIMIT 1;
  END IF;
  
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_api_key_info IS 'Retrieves API key info from client_api_keys table with correct data types';