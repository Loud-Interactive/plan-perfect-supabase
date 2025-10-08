-- Add template column to shopify_configs table
-- This allows setting Shopify blog post templates (e.g., "loud-blog-template")

ALTER TABLE shopify_configs 
ADD COLUMN shopify_template TEXT DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN shopify_configs.shopify_template IS 'Optional Shopify template suffix for blog posts (e.g., "loud-blog-template")';

-- No need for index as this is primarily used for reads with client_id