-- Create RPC function to update task with hero image URL
-- No casting needed - all columns are now TEXT
CREATE OR REPLACE FUNCTION update_task_hero_image(
  p_task_id TEXT,
  p_hero_image_url TEXT,
  p_hero_image_status TEXT,
  p_hero_image_thinking TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INT;
  v_task_exists BOOLEAN;
BEGIN
  -- First check if the task exists
  SELECT EXISTS(SELECT 1 FROM tasks WHERE task_id = p_task_id) INTO v_task_exists;

  IF NOT v_task_exists THEN
    RAISE WARNING 'update_task_hero_image: task_id=% does not exist in tasks table', p_task_id;
    RETURN FALSE;
  END IF;

  -- Disable triggers to avoid recursive calls when edge function updates task
  -- This prevents fn_request_hero_image from firing again
  SET session_replication_role = replica;

  -- Update task with hero image details
  UPDATE tasks SET
    hero_image_url = p_hero_image_url,
    hero_image_status = p_hero_image_status,
    hero_image_thinking = p_hero_image_thinking,
    updated_at = now()
  WHERE task_id = p_task_id;

  -- Re-enable triggers
  SET session_replication_role = DEFAULT;

  -- Get number of rows affected
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Log for debugging
  RAISE NOTICE 'update_task_hero_image: task_id=%, rows_affected=%, url=%',
    p_task_id, v_rows_affected, p_hero_image_url;

  -- Return true if at least one row was updated
  RETURN v_rows_affected > 0;
EXCEPTION WHEN OTHERS THEN
  -- Re-enable triggers even if there was an error
  SET session_replication_role = DEFAULT;
  -- Log detailed error and return false
  RAISE WARNING 'update_task_hero_image EXCEPTION: task_id=%, error=%, sqlstate=%',
    p_task_id, SQLERRM, SQLSTATE;
  RETURN FALSE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_task_hero_image TO anon, authenticated, service_role;

COMMENT ON FUNCTION update_task_hero_image IS 'Updates task with hero image URL and metadata with triggers disabled';