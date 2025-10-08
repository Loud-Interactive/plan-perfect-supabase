-- Drop existing function if it exists
DROP FUNCTION IF EXISTS public.get_api_key_info(TEXT);

-- Create function to get API key info from client_api_keys table
CREATE OR REPLACE FUNCTION public.get_api_key_info(p_domain TEXT)
RETURNS TABLE (
  api_key TEXT,
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
  -- Also include post limits (defaulting to unlimited if not set)
  RETURN QUERY
  SELECT 
    cak.api_key,
    'https://www.' || cak.domain || '/wp-json/wp/v2' as api_url,
    'https://www.' || cak.domain as site_url,
    cak.is_active as active,
    COALESCE(cak.monthly_post_limit, 0) as monthly_post_limit, -- 0 means unlimited
    COALESCE(cak.monthly_post_count, 0) as monthly_post_count
  FROM client_api_keys cak
  WHERE cak.domain = p_domain
  AND cak.is_active = true
  LIMIT 1;
  
  -- If not found with exact match, try with www prefix removed/added
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 
      cak.api_key,
      'https://www.' || cak.domain || '/wp-json/wp/v2' as api_url,
      'https://www.' || cak.domain as site_url,
      cak.is_active as active,
      COALESCE(cak.monthly_post_limit, 0) as monthly_post_limit,
      COALESCE(cak.monthly_post_count, 0) as monthly_post_count
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

-- Add monthly post limit columns to client_api_keys if they don't exist
ALTER TABLE client_api_keys 
ADD COLUMN IF NOT EXISTS monthly_post_limit INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS monthly_post_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS count_reset_at TIMESTAMPTZ;

-- Create function to increment post count
CREATE OR REPLACE FUNCTION public.increment_api_key_post_count(p_domain TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_count INTEGER;
  v_reset_date TIMESTAMPTZ;
BEGIN
  -- Check if we need to reset the monthly count
  SELECT count_reset_at INTO v_reset_date
  FROM client_api_keys
  WHERE domain = p_domain;
  
  -- If reset date is in the past or null, reset the count
  IF v_reset_date IS NULL OR v_reset_date < NOW() THEN
    UPDATE client_api_keys
    SET 
      monthly_post_count = 1,
      count_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month'
    WHERE domain = p_domain
    RETURNING monthly_post_count INTO v_new_count;
  ELSE
    -- Otherwise increment the count
    UPDATE client_api_keys
    SET monthly_post_count = COALESCE(monthly_post_count, 0) + 1
    WHERE domain = p_domain
    RETURNING monthly_post_count INTO v_new_count;
  END IF;
  
  RETURN v_new_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.increment_api_key_post_count(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_api_key_post_count(TEXT) TO service_role;

-- Add comments
COMMENT ON FUNCTION public.get_api_key_info IS 'Retrieves API key info from client_api_keys table including post limits';
COMMENT ON FUNCTION public.increment_api_key_post_count IS 'Increments the monthly post count for a domain, resetting when needed';
COMMENT ON COLUMN client_api_keys.monthly_post_limit IS 'Maximum posts allowed per month (0 = unlimited)';
COMMENT ON COLUMN client_api_keys.monthly_post_count IS 'Current number of posts this month';
COMMENT ON COLUMN client_api_keys.count_reset_at IS 'When to reset the monthly post count';