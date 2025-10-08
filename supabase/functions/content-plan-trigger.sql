-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create the trigger function
CREATE OR REPLACE FUNCTION trigger_content_plan_processing()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if content_plan_table has been changed and is not null
  IF (OLD.content_plan_table IS DISTINCT FROM NEW.content_plan_table) AND (NEW.content_plan_table IS NOT NULL) THEN
    -- Call the Edge Function with the content plan ID
    PERFORM pg_net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/process-content-plan',
      jsonb_build_object(
        'content_plan_id', NEW.guid
      ),
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"}'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on the content_plans table
DROP TRIGGER IF EXISTS trigger_process_content_plan ON "public"."content_plans";

CREATE TRIGGER trigger_process_content_plan
AFTER UPDATE OF content_plan_table ON "public"."content_plans"
FOR EACH ROW
EXECUTE FUNCTION trigger_content_plan_processing(); 