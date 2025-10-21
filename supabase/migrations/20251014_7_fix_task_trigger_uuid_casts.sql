-- Fix fn_handle_task_content_update trigger to use TEXT columns instead of UUID
-- This fixes "operator does not exist: text = uuid" error

CREATE OR REPLACE FUNCTION public.fn_handle_task_content_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_client_id UUID;
  v_has_shopify_config BOOLEAN;
  v_sync_exists BOOLEAN;
  v_shopify_config RECORD;
BEGIN
  -- Only process if content was actually changed
  IF OLD.content IS DISTINCT FROM NEW.content OR
     OLD.title IS DISTINCT FROM NEW.title OR
     OLD.hero_image_url IS DISTINCT FROM NEW.hero_image_url THEN

    -- Check if this task has a content_plan_outline_guid and client_domain
    IF NEW.content_plan_outline_guid IS NOT NULL AND NEW.client_domain IS NOT NULL THEN

      -- Check if there's a Shopify config matching this domain
      SELECT * INTO v_shopify_config
      FROM shopify_configs
      WHERE shopify_blog_url ILIKE '%' || NEW.client_domain || '%'
         OR NEW.client_domain ILIKE '%' || replace(replace(shopify_blog_url, 'https://', ''), 'http://', '') || '%'
      LIMIT 1;

      IF v_shopify_config.id IS NOT NULL THEN
        v_has_shopify_config := true;
        v_client_id := v_shopify_config.client_id;
      ELSE
        v_has_shopify_config := false;
      END IF;

      IF v_has_shopify_config THEN
        -- Check if sync status exists
        -- Use TEXT column comparison, no UUID cast needed
        SELECT EXISTS(
          SELECT 1 FROM shopify_sync_status
          WHERE content_plan_outline_guid = NEW.content_plan_outline_guid
        ) INTO v_sync_exists;

        IF v_sync_exists THEN
          -- Mark the sync status as needing update
          UPDATE shopify_sync_status
          SET
            needs_update = true,
            content_updated_at = NOW(),
            sync_error = 'Content regenerated - needs re-sync'
          WHERE content_plan_outline_guid = NEW.content_plan_outline_guid;

          -- Add to queue for re-processing
          INSERT INTO outline_shopify_queue (
            content_plan_outline_guid,
            client_id,
            operation,
            created_at
          )
          VALUES (
            NEW.content_plan_outline_guid,
            v_client_id,
            'update',
            NOW()
          )
          ON CONFLICT (content_plan_outline_guid, client_id)
          DO UPDATE SET
            operation = 'update',
            processed_at = NULL,
            error_message = NULL,
            retries = 0,
            updated_at = NOW();

          RAISE NOTICE 'Task content updated - queued for Shopify re-sync: % (domain: %)',
                       NEW.content_plan_outline_guid, NEW.client_domain;
        END IF;
      ELSE
        RAISE NOTICE 'No Shopify config found for domain: %', NEW.client_domain;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop the old UUID columns now that we're using TEXT
ALTER TABLE shopify_sync_status
  DROP COLUMN IF EXISTS content_plan_outline_guid_uuid_old;

ALTER TABLE shopify_sync_status
  DROP COLUMN IF EXISTS content_plan_outline_guid_uuid;

ALTER TABLE outline_shopify_queue
  DROP COLUMN IF EXISTS content_plan_outline_guid_uuid_old;

ALTER TABLE outline_shopify_queue
  DROP COLUMN IF EXISTS content_plan_outline_guid_uuid;

-- Verify the changes
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed fn_handle_task_content_update to use TEXT columns';
  RAISE NOTICE '✅ Dropped old UUID columns from shopify_sync_status';
  RAISE NOTICE '✅ Dropped old UUID columns from outline_shopify_queue';
END;
$$;

COMMENT ON FUNCTION fn_handle_task_content_update IS 'Handles task content updates and queues for Shopify sync - uses TEXT columns';
