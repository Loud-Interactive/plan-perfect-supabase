-- Fix RPC functions that try to disable triggers
-- Remove session_replication_role which requires superuser permissions

-- Update update_task_hero_image to not disable triggers
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

  -- Update task with hero image details
  -- Note: Triggers will fire, but that's okay for hero images
  UPDATE tasks SET
    hero_image_url = p_hero_image_url,
    hero_image_status = p_hero_image_status,
    hero_image_thinking = p_hero_image_thinking,
    updated_at = now()
  WHERE task_id = p_task_id;

  -- Get number of rows affected
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Log for debugging
  RAISE NOTICE 'update_task_hero_image: task_id=%, rows_affected=%, url=%',
    p_task_id, v_rows_affected, p_hero_image_url;

  -- Return true if at least one row was updated
  RETURN v_rows_affected > 0;
EXCEPTION WHEN OTHERS THEN
  -- Log detailed error and return false
  RAISE WARNING 'update_task_hero_image EXCEPTION: task_id=%, error=%, sqlstate=%',
    p_task_id, SQLERRM, SQLSTATE;
  RETURN FALSE;
END;
$$;

-- Update update_task_live_post_url to not disable triggers
CREATE OR REPLACE FUNCTION update_task_live_post_url(
  p_task_id TEXT,
  p_live_post_url TEXT,
  p_last_updated_at TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update task with live post URL
  UPDATE tasks SET
    live_post_url = p_live_post_url,
    last_updated_at = p_last_updated_at::timestamptz,
    updated_at = now()
  WHERE task_id = p_task_id;

  -- Return true if successful
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  -- Log error and return false
  RAISE WARNING 'Error updating task live post URL: %', SQLERRM;
  RETURN FALSE;
END;
$$;

-- Update update_task_status_by_id to not disable triggers
CREATE OR REPLACE FUNCTION update_task_status_by_id(
  p_task_id TEXT,
  p_status TEXT,
  p_additional_data JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INT;
BEGIN
  UPDATE tasks SET
    status = p_status,
    updated_at = now(),
    -- Merge additional_data if provided
    article_json = CASE
      WHEN p_additional_data IS NOT NULL AND p_additional_data ? 'article_json'
      THEN (p_additional_data->>'article_json')::jsonb
      ELSE article_json
    END,
    meta_description = CASE
      WHEN p_additional_data IS NOT NULL AND p_additional_data ? 'meta_description'
      THEN p_additional_data->>'meta_description'
      ELSE meta_description
    END,
    factcheck = CASE
      WHEN p_additional_data IS NOT NULL AND p_additional_data ? 'factcheck'
      THEN (p_additional_data->>'factcheck')::jsonb
      ELSE factcheck
    END,
    hero_image_url = CASE
      WHEN p_additional_data IS NOT NULL AND p_additional_data ? 'hero_image_url'
      THEN p_additional_data->>'hero_image_url'
      ELSE hero_image_url
    END
  WHERE task_id = p_task_id;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected > 0;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error updating task status: %', SQLERRM;
  RETURN FALSE;
END;
$$;

-- Add comments explaining the change
COMMENT ON FUNCTION update_task_hero_image IS 'Updates task with hero image URL and metadata - triggers enabled';
COMMENT ON FUNCTION update_task_live_post_url IS 'Updates task with live post URL - triggers enabled';
COMMENT ON FUNCTION update_task_status_by_id IS 'Update task status - triggers enabled';

-- Verify the functions were updated
DO $$
BEGIN
  RAISE NOTICE '✅ RPC functions updated to work without session_replication_role';
  RAISE NOTICE '   - update_task_hero_image: triggers enabled';
  RAISE NOTICE '   - update_task_live_post_url: triggers enabled';
  RAISE NOTICE '   - update_task_status_by_id: triggers enabled';
END;
$$;
