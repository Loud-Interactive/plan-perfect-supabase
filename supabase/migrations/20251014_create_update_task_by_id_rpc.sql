-- Create general-purpose RPC function to update any task fields by ID
-- This handles UUID casting and accepts dynamic update fields as JSONB
-- Uses PATCH-style semantics: only updates fields provided in p_update_data
CREATE OR REPLACE FUNCTION update_task_by_id(
  p_task_id TEXT,
  p_update_data JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_sql TEXT;
  v_set_clauses TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
  v_value JSONB;
  v_rows_affected INT;
  v_task_exists BOOLEAN;
BEGIN
  -- First check if the task exists
  SELECT EXISTS(SELECT 1 FROM tasks WHERE task_id = p_task_id) INTO v_task_exists;

  IF NOT v_task_exists THEN
    RAISE WARNING 'update_task_by_id: task_id=% does not exist in tasks table', p_task_id;
    RETURN FALSE;
  END IF;

  -- Build SET clauses dynamically from JSONB keys
  -- Use jsonb_each() instead of jsonb_each_text() to preserve types
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_update_data)
  LOOP
    -- For JSONB columns only (post_json, schema_data are JSONB; hero_image_thinking is TEXT)
    IF v_key IN ('post_json', 'schema_data') THEN
      v_set_clauses := array_append(v_set_clauses, format('%I = %L::jsonb', v_key, v_value));
    -- For text/varchar columns, extract as text
    ELSIF jsonb_typeof(v_value) = 'string' THEN
      v_set_clauses := array_append(v_set_clauses, format('%I = %L', v_key, v_value #>> '{}'));
    -- For other types (numbers, booleans), convert to text
    ELSE
      v_set_clauses := array_append(v_set_clauses, format('%I = %L', v_key, v_value #>> '{}'));
    END IF;
  END LOOP;

  -- Always set updated_at if not explicitly provided
  IF NOT (p_update_data ? 'updated_at') THEN
    v_set_clauses := array_append(v_set_clauses, 'updated_at = now()');
  END IF;

  -- Build and execute the UPDATE statement
  v_sql := format(
    'UPDATE tasks SET %s WHERE task_id = %L',
    array_to_string(v_set_clauses, ', '),
    p_task_id
  );

  EXECUTE v_sql;

  -- Get number of rows affected
  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  -- Log for debugging
  RAISE NOTICE 'update_task_by_id: task_id=%, rows_affected=%, fields=%',
    p_task_id, v_rows_affected, jsonb_object_keys(p_update_data);

  -- Return true if successful
  RETURN v_rows_affected > 0;
EXCEPTION WHEN OTHERS THEN
  -- Log detailed error
  RAISE WARNING 'update_task_by_id EXCEPTION: task_id=%, error=%, sqlstate=%, sql=%',
    p_task_id, SQLERRM, SQLSTATE, v_sql;
  RETURN FALSE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_task_by_id TO anon, authenticated, service_role;

COMMENT ON FUNCTION update_task_by_id IS 'General-purpose task update function that accepts dynamic JSONB fields - TEXT columns, no casting needed';
