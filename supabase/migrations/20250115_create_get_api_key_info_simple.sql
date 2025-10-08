-- Simple function to get API key info from existing client_api_keys table
CREATE OR REPLACE FUNCTION public.get_api_key_info(p_domain TEXT)
RETURNS TABLE (
  api_key TEXT,
  api_url TEXT,
  site_url TEXT,
  active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return the API key and construct WordPress URLs based on the domain
  RETURN QUERY
  SELECT 
    cak.api_key,
    'https://www.' || cak.domain || '/wp-json/wp/v2' as api_url,
    'https://www.' || cak.domain as site_url,
    cak.is_active as active
  FROM client_api_keys cak
  WHERE cak.domain = p_domain
  AND cak.is_active = true
  LIMIT 1;
  
  -- If not found with exact match, try with www prefix removed
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 
      cak.api_key,
      'https://www.' || cak.domain || '/wp-json/wp/v2' as api_url,
      'https://www.' || cak.domain as site_url,
      cak.is_active as active
    FROM client_api_keys cak
    WHERE cak.domain = REPLACE(p_domain, 'www.', '')
    OR cak.domain = 'www.' || p_domain
    AND cak.is_active = true
    LIMIT 1;
  END IF;
  
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO service_role;

COMMENT ON FUNCTION public.get_api_key_info IS 'Retrieves API key info from client_api_keys table and constructs WordPress URLs';