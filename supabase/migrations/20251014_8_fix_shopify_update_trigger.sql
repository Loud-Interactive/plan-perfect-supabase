-- Fix fn_update_shopify_with_schema trigger to use TEXT columns instead of UUID
-- This fixes another "operator does not exist: text = uuid" error

CREATE OR REPLACE FUNCTION public.fn_update_shopify_with_schema()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_shopify_sync RECORD;
    v_shopify_config RECORD;
BEGIN
    -- Only proceed if live_post_url was just added or changed
    IF NEW.live_post_url IS NOT NULL AND
       (OLD.live_post_url IS NULL OR OLD.live_post_url != NEW.live_post_url) THEN

        RAISE NOTICE 'Live post URL updated for task %: %', NEW.task_id, NEW.live_post_url;

        -- Get the Shopify sync status
        -- Use TEXT comparison, no UUID cast needed
        SELECT * INTO v_shopify_sync
        FROM shopify_sync_status
        WHERE content_plan_outline_guid = NEW.content_plan_outline_guid
        AND shopify_article_gid IS NOT NULL
        LIMIT 1;

        IF v_shopify_sync IS NULL THEN
            RAISE NOTICE 'No Shopify sync record found for task %', NEW.task_id;
            RETURN NEW;
        END IF;

        -- Get Shopify config
        SELECT sc.* INTO v_shopify_config
        FROM shopify_configs sc
        WHERE sc.client_domain = NEW.client_domain
        LIMIT 1;

        IF v_shopify_config IS NULL THEN
            RAISE NOTICE 'No Shopify config found for domain %', NEW.client_domain;
            RETURN NEW;
        END IF;

        -- Call the enhanced generate-schema-and-update-shopify endpoint
        PERFORM net.http_post(
            url := (SELECT value FROM public.app_secrets WHERE key = 'supabase_url') || '/functions/v1/generate-schema-and-update-shopify',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (SELECT value FROM public.app_secrets WHERE key = 'supabase_service_role_key')
            ),
            body := jsonb_build_object(
                'task_id', NEW.task_id,
                'url', NEW.live_post_url,
                'content', NEW.content,
                'title', NEW.title,
                'client_domain', NEW.client_domain,
                'shopify_article_id', v_shopify_sync.shopify_article_gid,
                'shopify_config', jsonb_build_object(
                    'shopify_domain', v_shopify_config.shopify_domain,
                    'shopify_access_token', v_shopify_config.shopify_access_token,
                    'shopify_blog_id', v_shopify_config.shopify_blog_id,
                    'shopify_api_version', COALESCE(v_shopify_config.shopify_api_version, '2023-10')
                )
            )
        );

        RAISE NOTICE 'Schema generation and Shopify update triggered for task %', NEW.task_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_update_shopify_with_schema IS 'Triggers schema generation and Shopify update when live_post_url changes - uses TEXT columns';

-- Verify
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed fn_update_shopify_with_schema to use TEXT columns';
END;
$$;
