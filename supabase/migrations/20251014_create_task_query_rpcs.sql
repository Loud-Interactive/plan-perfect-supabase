-- Create RPC functions for querying tasks - TEXT columns
-- This fixes "column task_id is of type uuid but expression is of type text" errors

-- Get single task by task_id
CREATE OR REPLACE FUNCTION get_task_by_id(p_task_id TEXT)
RETURNS SETOF tasks
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM tasks
  WHERE task_id = p_task_id;
END;
$$;

-- Get tasks by content_plan_outline_guid
CREATE OR REPLACE FUNCTION get_tasks_by_outline_guid(p_outline_guid TEXT)
RETURNS SETOF tasks
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM tasks
  WHERE content_plan_outline_guid = p_outline_guid;
END;
$$;

-- Get tasks by content_plan_guid
CREATE OR REPLACE FUNCTION get_tasks_by_content_plan_guid(p_content_plan_guid TEXT)
RETURNS SETOF tasks
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM tasks
  WHERE content_plan_guid_uuid = p_content_plan_guid;
END;
$$;

-- Update task status by task_id
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
  -- Disable triggers to prevent recursive calls
  SET session_replication_role = replica;

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

  -- Re-enable triggers
  SET session_replication_role = DEFAULT;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected > 0;
EXCEPTION WHEN OTHERS THEN
  -- Re-enable triggers even if there was an error
  SET session_replication_role = DEFAULT;
  RAISE WARNING 'Error updating task status: %', SQLERRM;
  RETURN FALSE;
END;
$$;

-- Delete task by task_id
CREATE OR REPLACE FUNCTION delete_task_by_id(p_task_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows_affected INT;
BEGIN
  DELETE FROM tasks
  WHERE task_id = p_task_id;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected > 0;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_task_by_id TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_tasks_by_outline_guid TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_tasks_by_content_plan_guid TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_task_status_by_id TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_task_by_id TO anon, authenticated, service_role;

-- Comments
COMMENT ON FUNCTION get_task_by_id IS 'Get single task by task_id - TEXT columns, no casting needed';
COMMENT ON FUNCTION get_tasks_by_outline_guid IS 'Get tasks by content_plan_outline_guid - TEXT columns, no casting needed';
COMMENT ON FUNCTION get_tasks_by_content_plan_guid IS 'Get tasks by content_plan_guid_uuid - TEXT columns, no casting needed';
COMMENT ON FUNCTION update_task_status_by_id IS 'Update task status - TEXT columns, no casting needed and trigger disabling';
COMMENT ON FUNCTION delete_task_by_id IS 'Delete task by task_id - TEXT columns, no casting needed';
