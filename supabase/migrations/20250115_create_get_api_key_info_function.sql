-- Create function to get API key info for WordPress publishing
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
  -- First check if there's a specific WordPress configuration for this domain
  RETURN QUERY
  SELECT 
    wc.api_key,
    wc.api_url,
    wc.site_url,
    wc.active
  FROM wordpress_configs wc
  WHERE wc.domain = p_domain
  AND wc.active = true
  LIMIT 1;
  
  -- If no specific config found, check if there's a general API key storage
  IF NOT FOUND THEN
    -- Check in app_settings or api_keys table
    RETURN QUERY
    SELECT 
      CASE 
        WHEN setting_key = 'wordpress_api_key' THEN setting_value::TEXT
        ELSE NULL
      END as api_key,
      CASE 
        WHEN setting_key = 'wordpress_api_url' THEN setting_value::TEXT
        ELSE NULL
      END as api_url,
      CASE 
        WHEN setting_key = 'wordpress_site_url' THEN setting_value::TEXT
        ELSE NULL
      END as site_url,
      true as active
    FROM app_settings
    WHERE setting_key IN ('wordpress_api_key', 'wordpress_api_url', 'wordpress_site_url')
    AND domain = p_domain
    LIMIT 1;
  END IF;
  
  -- If still not found, return empty result
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO service_role;

-- Create wordpress_configs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.wordpress_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL,
  api_url TEXT NOT NULL,
  site_url TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_wordpress_configs_domain ON wordpress_configs(domain);

-- Enable RLS
ALTER TABLE wordpress_configs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage wordpress configs"
ON wordpress_configs
FOR ALL
TO service_role
USING (true);

-- Create app_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT,
  setting_key TEXT NOT NULL,
  setting_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(domain, setting_key)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_app_settings_domain_key ON app_settings(domain, setting_key);

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage app settings"
ON app_settings
FOR ALL
TO service_role
USING (true);

-- Insert example WordPress config (update with your actual values)
-- INSERT INTO wordpress_configs (domain, api_key, api_url, site_url)
-- VALUES (
--   'example.com',
--   'your_wordpress_api_key_here',
--   'https://example.com/wp-json/wp/v2',
--   'https://example.com'
-- );

COMMENT ON FUNCTION public.get_api_key_info IS 'Retrieves WordPress API configuration for a given domain';
COMMENT ON TABLE wordpress_configs IS 'Stores WordPress API credentials and endpoints for different domains';
COMMENT ON TABLE app_settings IS 'General application settings storage';