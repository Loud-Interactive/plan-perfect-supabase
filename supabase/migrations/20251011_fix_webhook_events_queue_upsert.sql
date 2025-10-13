-- Fix webhook_events_queue duplicate key errors by using upsert behavior
-- This migration creates a function that can be called by Database Webhooks

-- Create a function to safely insert/update webhook events
CREATE OR REPLACE FUNCTION upsert_webhook_event(
  p_id UUID,
  p_event_type TEXT,
  p_payload JSONB,
  p_domain TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Use INSERT ... ON CONFLICT to handle duplicates
  INSERT INTO webhook_events_queue (id, event_type, payload, domain, processed, created_at)
  VALUES (p_id, p_event_type, p_payload, p_domain, FALSE, NOW())
  ON CONFLICT (id)
  DO UPDATE SET
    event_type = EXCLUDED.event_type,
    payload = EXCLUDED.payload,
    domain = EXCLUDED.domain,
    processed = FALSE,
    created_at = NOW();
END;
$$;

-- Create a trigger function that converts INSERT to UPSERT for webhook_events_queue
CREATE OR REPLACE FUNCTION webhook_events_queue_upsert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If a row with this ID already exists, update it instead of inserting
  IF EXISTS (SELECT 1 FROM webhook_events_queue WHERE id = NEW.id) THEN
    UPDATE webhook_events_queue
    SET
      event_type = NEW.event_type,
      payload = NEW.payload,
      domain = NEW.domain,
      processed = FALSE,
      created_at = NOW()
    WHERE id = NEW.id;
    RETURN NULL; -- Cancel the INSERT
  ELSE
    RETURN NEW; -- Allow the INSERT
  END IF;
END;
$$;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS webhook_events_queue_upsert ON webhook_events_queue;

-- Create a BEFORE INSERT trigger that converts INSERT to UPSERT
CREATE TRIGGER webhook_events_queue_upsert
  BEFORE INSERT ON webhook_events_queue
  FOR EACH ROW
  EXECUTE FUNCTION webhook_events_queue_upsert_trigger();

-- Add comment explaining the fix
COMMENT ON TRIGGER webhook_events_queue_upsert ON webhook_events_queue IS
  'Converts INSERT operations to UPSERT to prevent duplicate key errors when retrying webhook events';
