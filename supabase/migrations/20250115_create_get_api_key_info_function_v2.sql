-- Create function to get API key info for WordPress publishing using existing client_api_keys table
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
DECLARE
  v_client_id UUID;
  v_wordpress_config RECORD;
BEGIN
  -- First, get the client_id from the client_api_keys table
  SELECT client_id INTO v_client_id
  FROM client_api_keys
  WHERE domain = p_domain
  AND is_active = true
  LIMIT 1;

  -- If we found a client, look for their WordPress configuration
  IF v_client_id IS NOT NULL THEN
    -- Check if there's WordPress config in the clients table or related tables
    -- First try to find WordPress settings in client_settings or wordpress_settings
    SELECT 
      ws.api_key,
      ws.api_url,
      ws.site_url,
      ws.is_active as active
    INTO v_wordpress_config
    FROM wordpress_settings ws
    WHERE ws.client_id = v_client_id
    AND ws.is_active = true
    LIMIT 1;
    
    IF FOUND THEN
      RETURN QUERY
      SELECT 
        v_wordpress_config.api_key,
        v_wordpress_config.api_url,
        v_wordpress_config.site_url,
        v_wordpress_config.active;
      RETURN;
    END IF;
  END IF;

  -- If no WordPress settings found, construct default URLs based on domain
  -- and return the API key from client_api_keys
  RETURN QUERY
  SELECT 
    cak.api_key,
    'https://' || cak.domain || '/wp-json/wp/v2' as api_url,
    'https://' || cak.domain as site_url,
    cak.is_active as active
  FROM client_api_keys cak
  WHERE cak.domain = p_domain
  AND cak.is_active = true
  LIMIT 1;
  
  RETURN;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_key_info(TEXT) TO service_role;

-- Create wordpress_settings table to store WordPress-specific configuration
CREATE TABLE IF NOT EXISTS public.wordpress_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  api_url TEXT NOT NULL,
  site_url TEXT NOT NULL,
  username TEXT, -- WordPress username if needed
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_wordpress_settings_client_id ON wordpress_settings(client_id);

-- Enable RLS
ALTER TABLE wordpress_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage wordpress settings"
ON wordpress_settings
FOR ALL
TO service_role
USING (true);

-- Insert WordPress settings for your existing client
-- You'll need to update this with the actual WordPress Application Password
INSERT INTO wordpress_settings (client_id, api_key, api_url, site_url, username)
VALUES (
  '2ca2b058-8930-47ca-a4e1-939adcc9ed7c', -- motoworkschicago client_id
  'YOUR_WORDPRESS_APPLICATION_PASSWORD_HERE', -- Replace with actual WordPress app password
  'https://www.motoworkschicago.com/wp-json/wp/v2',
  'https://www.motoworkschicago.com',
  'admin' -- or whatever WordPress username you're using
)
ON CONFLICT (client_id) DO NOTHING;

COMMENT ON FUNCTION public.get_api_key_info IS 'Retrieves WordPress API configuration for a given domain using client_api_keys table';
COMMENT ON TABLE wordpress_settings IS 'Stores WordPress-specific API credentials and endpoints for clients';