-- Create RPC function to update task with hero image URL
-- This handles UUID casting to avoid "uuid = text" operator errors
CREATE OR REPLACE FUNCTION update_task_hero_image(
  p_task_id TEXT,
  p_hero_image_url TEXT,
  p_hero_image_status TEXT,
  p_hero_image_thinking TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update task with hero image details, casting TEXT to UUID
  UPDATE tasks SET
    hero_image_url = p_hero_image_url,
    hero_image_status = p_hero_image_status,
    hero_image_thinking = p_hero_image_thinking,
    updated_at = now()
  WHERE task_id = p_task_id::uuid;

  -- Return true if successful
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  -- Log error and return false
  RAISE WARNING 'Error updating task hero image: %', SQLERRM;
  RETURN FALSE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_task_hero_image TO anon, authenticated, service_role;

COMMENT ON FUNCTION update_task_hero_image IS 'Updates task with hero image URL and metadata with proper UUID casting';