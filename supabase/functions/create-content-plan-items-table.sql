-- Create the content_plan_items table
CREATE TABLE IF NOT EXISTS content_plan_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_plan_id UUID REFERENCES content_plans(guid),
  hub_number INTEGER,
  spoke_number INTEGER,
  post_title TEXT NOT NULL,
  keyword TEXT NOT NULL,
  url_slug TEXT NOT NULL,
  cpc TEXT,
  difficulty INTEGER,
  volume INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_content_plan_items_content_plan_id ON content_plan_items(content_plan_id);
CREATE INDEX IF NOT EXISTS idx_content_plan_items_hub_spoke ON content_plan_items(hub_number, spoke_number);

-- Add function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to automatically update the updated_at timestamp
DROP TRIGGER IF EXISTS trigger_update_content_plan_items_timestamp ON content_plan_items;
CREATE TRIGGER trigger_update_content_plan_items_timestamp
BEFORE UPDATE ON content_plan_items
FOR EACH ROW
EXECUTE FUNCTION update_modified_column(); 