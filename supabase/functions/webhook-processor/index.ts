import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";
import { triggerCentrWebhooks } from "../_shared/webhook-helpers-v2.ts";

/**
 * Edge function to process webhook queue
 * This should be called periodically (via cron) to process queued webhook events
 */

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Process webhook queue
    const { data: queuedEvents, error: queueError } = await supabase
      .rpc('process_webhook_queue');

    if (queueError) {
      console.error("Error processing webhook queue:", queueError);
      return new Response(
        JSON.stringify({ error: "Failed to process webhook queue" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    if (!queuedEvents || queuedEvents.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No webhook events to process",
          processed: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    console.log(`Processing ${queuedEvents.length} webhook events`);

    // Process each event
    const results = await Promise.allSettled(
      queuedEvents.map(async (event: any) => {
        try {
          // Format the data according to Centr's expected format
          // IMPORTANT: Ensure task_id is included for Centr compatibility
          // Centr uses task_id as the 'id' field, not content_plan_outline_guid
          const formattedData = {
            task_id: event.payload.task_id || event.id, // Prioritize task_id
            status: event.payload.status || 'Unknown',
            title: event.payload.title || '',
            slug: event.payload.slug || '',
            client_domain: event.payload.client_domain || event.domain || '',
            html_link: event.payload.html_link,
            google_doc_link: event.payload.google_doc_link,
            content: event.payload.content,
            seo_keyword: event.payload.seo_keyword,
            hero_image_url: event.payload.hero_image_url,
            meta_description: event.payload.meta_description,
            live_post_url: event.payload.live_post_url,
            ...event.payload
          };

          // Use task_id as guid (Centr expects task_id, not content_plan_outline_guid)
          const webhookGuid = formattedData.task_id || event.payload.guid || event.id;

          await triggerCentrWebhooks(
            supabase,
            event.event_type,
            formattedData,
            webhookGuid
          );

          return { success: true, id: event.id };
        } catch (error) {
          console.error(`Failed to process webhook event ${event.id}:`, error);

          // Mark as failed in the queue
          await supabase
            .from('webhook_events_queue')
            .update({
              processed: false,
              error: error.message
            })
            .eq('id', event.id);

          return { success: false, id: event.id, error: error.message };
        }
      })
    );

    // Count successes and failures
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${queuedEvents.length} webhook events`,
        processed: queuedEvents.length,
        successful,
        failed
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Webhook processor error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});