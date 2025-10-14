-- Create general-purpose RPC function to update any task fields by ID
-- This handles UUID casting and accepts dynamic update fields as JSONB
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
  v_value TEXT;
BEGIN
  -- Build SET clauses dynamically from JSONB keys
  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_update_data)
  LOOP
    -- Special handling for JSONB/JSON columns that need type casting
    IF v_key IN ('post_json', 'schema_data', 'hero_image_thinking') THEN
      v_set_clauses := array_append(v_set_clauses, format('%I = %L::jsonb', v_key, v_value));
    -- Regular text/timestamp columns
    ELSE
      v_set_clauses := array_append(v_set_clauses, format('%I = %L', v_key, v_value));
    END IF;
  END LOOP;

  -- Always set updated_at if not explicitly provided
  IF NOT (p_update_data ? 'updated_at') THEN
    v_set_clauses := array_append(v_set_clauses, 'updated_at = now()');
  END IF;

  -- Build and execute the UPDATE statement
  v_sql := format(
    'UPDATE tasks SET %s WHERE task_id = %L::uuid',
    array_to_string(v_set_clauses, ', '),
    p_task_id
  );

  EXECUTE v_sql;

  -- Return true if successful
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  -- Log error and return false
  RAISE WARNING 'Error updating task by ID: % (SQL: %)', SQLERRM, v_sql;
  RETURN FALSE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_task_by_id TO anon, authenticated, service_role;

COMMENT ON FUNCTION update_task_by_id IS 'General-purpose task update function that accepts dynamic JSONB fields with proper UUID casting';
