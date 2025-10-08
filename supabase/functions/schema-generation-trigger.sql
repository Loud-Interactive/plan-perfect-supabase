-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create the trigger function
CREATE OR REPLACE FUNCTION trigger_schema_generation()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if live_post_url has been changed and is not null
  IF (OLD.live_post_url IS DISTINCT FROM NEW.live_post_url) AND (NEW.live_post_url IS NOT NULL) THEN
    -- Call the Edge Function with the necessary data
    PERFORM net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-schema',
      jsonb_build_object(
        'task_id', NEW.task_id,
        'live_post_url', NEW.live_post_url
      ),
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"}'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger on the tasks table
CREATE TRIGGER trigger_generate_schema
AFTER UPDATE OF live_post_url ON "public"."tasks"
FOR EACH ROW
EXECUTE FUNCTION trigger_schema_generation();