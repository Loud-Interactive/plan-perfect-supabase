-- Function to call the generate-schema edge function when live_post_url is updated
CREATE OR REPLACE FUNCTION trigger_schema_generation()
RETURNS TRIGGER AS $$
DECLARE
  status_code INTEGER;
  content_text TEXT;
  request_id UUID;
BEGIN
  -- Only proceed if live_post_url is set or changed
  IF (TG_OP = 'UPDATE' AND (NEW.live_post_url IS DISTINCT FROM OLD.live_post_url)) OR
     (TG_OP = 'INSERT' AND NEW.live_post_url IS NOT NULL) THEN
     
    -- Skip if live_post_url is empty
    IF NEW.live_post_url = '' OR NEW.live_post_url IS NULL THEN
      RETURN NEW;
    END IF;
    
    -- Only proceed if schema_data is empty (don't overwrite existing schemas)
    IF NEW.schema_data IS NULL OR NEW.schema_data = '' THEN
      -- Log the trigger execution
      RAISE NOTICE 'Calling schema generation for outline % with URL %', NEW.guid, NEW.live_post_url;
      
      -- Call the edge function
      SELECT
        INTO status_code, content_text, request_id
        status, content::text, id
      FROM
        net.http_post(
          url := rtrim(current_setting('app.settings.supabase_url'), '/') || '/functions/v1/generate-schema',
          headers := json_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
          ),
          body := json_build_object(
            'content_plan_outline_guid', NEW.guid,
            'live_post_url', NEW.live_post_url
          )
        );
        
      -- Log the response
      RAISE NOTICE 'Schema generation response: status=%, request_id=%', status_code, request_id;
      
      -- If the request was not successful, log the error
      IF status_code <> 200 THEN
        RAISE WARNING 'Schema generation failed: status=%, response=%, request_id=%', 
          status_code, content_text, request_id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on content_plan_outlines
DROP TRIGGER IF EXISTS trigger_schema_generation ON content_plan_outlines;

CREATE TRIGGER trigger_schema_generation
AFTER INSERT OR UPDATE OF live_post_url ON content_plan_outlines
FOR EACH ROW
EXECUTE FUNCTION trigger_schema_generation();

-- Add a comment to explain the trigger
COMMENT ON TRIGGER trigger_schema_generation ON content_plan_outlines IS 
'Automatically calls the generate-schema edge function when live_post_url is set or updated and schema_data is empty';

-- NOTE: This trigger requires the net extension to be enabled and 
-- the following settings to be configured:
--
-- ALTER DATABASE your_database_name SET app.settings.supabase_url = 'https://your-project-ref.supabase.co';
-- ALTER DATABASE your_database_name SET app.settings.service_role_key = 'your-service-role-key';
--
-- You can run these commands to set up the required configuration: