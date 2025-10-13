-- Fix the trigger_outline_webhook function to not reference the non-existent metadata column

-- First, let's recreate the function without the metadata reference
-- The trigger should queue a webhook event when outline_generation_jobs status changes to 'completed'

CREATE OR REPLACE FUNCTION trigger_outline_webhook()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger webhook when status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    -- Insert webhook event into queue
    INSERT INTO webhook_events_queue (
      id,
      event_type,
      payload,
      domain,
      processed
    ) VALUES (
      NEW.id,  -- Use job id as webhook event id for upsert safety
      'outline.completed',
      jsonb_build_object(
        'job_id', NEW.id,
        'content_plan_guid', NEW.content_plan_guid,
        'post_title', NEW.post_title,
        'post_keyword', NEW.post_keyword,
        'domain', NEW.domain,
        'status', NEW.status,
        'fast_mode', NEW.fast_mode,
        'updated_at', NEW.updated_at
      ),
      NEW.domain,
      false
    )
    ON CONFLICT (id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Comment explaining the trigger
COMMENT ON FUNCTION trigger_outline_webhook() IS
'Queues a webhook event when an outline generation job completes. Uses job_id as webhook event id for idempotent upserts.';
