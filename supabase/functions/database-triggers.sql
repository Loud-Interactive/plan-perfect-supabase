-- Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schema Generation Trigger
CREATE OR REPLACE FUNCTION trigger_schema_generation()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if live_post_url has been changed and is not null
  IF (OLD.live_post_url IS DISTINCT FROM NEW.live_post_url) AND (NEW.live_post_url IS NOT NULL) THEN
    -- Call the Edge Function with the necessary data
    PERFORM pg_net.http_post(
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

CREATE TRIGGER trigger_generate_schema
AFTER UPDATE OF live_post_url ON "public"."tasks"
FOR EACH ROW
EXECUTE FUNCTION trigger_schema_generation();

-- Fact Check Trigger
CREATE OR REPLACE FUNCTION trigger_factcheck_generation()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.factcheck_status = 'Requested') THEN
    PERFORM pg_net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-factcheck',
      jsonb_build_object('task_id', NEW.task_id),
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"}'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_factcheck
AFTER UPDATE OF factcheck_status ON "public"."tasks"
FOR EACH ROW
EXECUTE FUNCTION trigger_factcheck_generation();

-- Index Generation Trigger
CREATE OR REPLACE FUNCTION trigger_index_generation()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.index_status = 'Requested') THEN
    PERFORM pg_net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-index',
      jsonb_build_object('task_id', NEW.task_id),
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"}'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_index
AFTER UPDATE OF index_status ON "public"."tasks"
FOR EACH ROW
EXECUTE FUNCTION trigger_index_generation();

-- Meta Description Generation Trigger
CREATE OR REPLACE FUNCTION trigger_meta_description_generation()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.meta_description IS NULL AND NEW.content IS NOT NULL) THEN
    PERFORM pg_net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/generate-meta-description',
      jsonb_build_object('task_id', NEW.task_id),
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"}'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_generate_meta_description
AFTER UPDATE OF content ON "public"."tasks"
FOR EACH ROW
EXECUTE FUNCTION trigger_meta_description_generation();

-- Email Notification Trigger
CREATE OR REPLACE FUNCTION trigger_email_notification()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pg_net.http_post(
      'https://jsypctdhynsdqrfifvdh.supabase.co/functions/v1/send-notification',
      jsonb_build_object(
        'task_id', NEW.task_id,
        'old_status', OLD.status,
        'new_status', NEW.status,
        'email', NEW.email
      ),
      '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpzeXBjdGRoeW5zZHFyZmlmdmRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2OTIwMzIsImV4cCI6MjA1NjI2ODAzMn0.2QxOFFLzmp6VByWImiw6zDz3rWy-5hsvEHw3EMemIKY"}'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_send_notification
AFTER UPDATE OF status ON "public"."tasks"
FOR EACH ROW
EXECUTE FUNCTION trigger_email_notification();