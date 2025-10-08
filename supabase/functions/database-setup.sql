-- Create database tables and stored procedures for PlanPerfect

-- Create the stored procedure to get latest tasks by GUIDs
CREATE OR REPLACE FUNCTION get_latest_tasks_by_guids(guid_list TEXT[])
RETURNS SETOF tasks AS $$
BEGIN
  RETURN QUERY
  WITH ranked_tasks AS (
    SELECT 
      t.*,
      ROW_NUMBER() OVER (
        PARTITION BY t.content_plan_outline_guid 
        ORDER BY t.created_at DESC
      ) as rn
    FROM 
      tasks t
    WHERE 
      t.content_plan_outline_guid = ANY(guid_list)
  )
  SELECT * FROM ranked_tasks WHERE rn = 1;
END;
$$ LANGUAGE plpgsql;

-- Add RLS policies for tasks table
-- Note: Adjust these policies according to your security requirements
BEGIN;

-- Enable RLS on tasks table
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations for authenticated users
CREATE POLICY tasks_policy ON tasks
  FOR ALL
  TO authenticated
  USING (true);

-- Allow anon users to read tasks (useful for API endpoints)
CREATE POLICY tasks_anon_read ON tasks
  FOR SELECT
  TO anon
  USING (true);

-- Add RLS to supporting tables
-- Assuming we have 'factchecks' and 'indices' tables
ALTER TABLE factchecks ENABLE ROW LEVEL SECURITY;
ALTER TABLE indices ENABLE ROW LEVEL SECURITY;

CREATE POLICY factchecks_policy ON factchecks
  FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY indices_policy ON indices
  FOR ALL
  TO authenticated
  USING (true);

COMMIT;