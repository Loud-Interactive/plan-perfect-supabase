-- Create RPC function to update task with live post URL
-- This handles UUID casting to avoid "uuid = text" operator errors
CREATE OR REPLACE FUNCTION update_task_live_post_url(
  p_task_id TEXT,
  p_live_post_url TEXT,
  p_last_updated_at TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update task with live post URL, casting TEXT to UUID
  UPDATE tasks SET
    live_post_url = p_live_post_url,
    last_updated_at = p_last_updated_at::timestamptz,
    updated_at = now()
  WHERE task_id = p_task_id::uuid;

  -- Return true if successful
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  -- Log error and return false
  RAISE WARNING 'Error updating task live post URL: %', SQLERRM;
  RETURN FALSE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_task_live_post_url TO anon, authenticated, service_role;

COMMENT ON FUNCTION update_task_live_post_url IS 'Updates task with live post URL with proper UUID casting';
