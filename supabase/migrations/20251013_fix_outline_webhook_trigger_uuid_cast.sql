-- Fix the trigger_outline_webhook function to cast TEXT id to UUID
-- outline_generation_jobs.id is TEXT, but webhook_events_queue.id is UUID

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
      NEW.id::uuid,  -- Cast TEXT to UUID for webhook event id (for upsert safety)
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
      created_at = now();  -- Update created_at instead of non-existent updated_at
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_outline_webhook() IS
'Queues a webhook event when an outline generation job completes. Casts job_id (TEXT) to UUID for webhook event id for idempotent upserts.';
