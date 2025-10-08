import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";
import { triggerWebhooks } from "../_shared/webhook-helpers.ts";

/**
 * Edge function to trigger webhooks for events
 * This can be called internally by other edge functions or via API
 */

interface TriggerRequest {
  event: string;
  data: any;
  metadata?: {
    task_id?: string;
    job_id?: string;
    domain?: string;
    [key: string]: any;
  };
  api_key?: string; // Optional, for external triggers
}

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

    // Parse request body
    const body: TriggerRequest = await req.json();

    // Validate required fields
    if (!body.event || !body.data) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: event and data are required"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // If API key is provided, validate it
    if (body.api_key) {
      const { data: apiKeyData, error: apiKeyError } = await supabase
        .from("api_keys_domains")
        .select("*")
        .eq("api_key", body.api_key)
        .eq("is_active", true)
        .single();

      if (apiKeyError || !apiKeyData) {
        return new Response(
          JSON.stringify({ error: "Invalid API key" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      // Add domain to metadata if not present
      if (!body.metadata) {
        body.metadata = {};
      }
      if (!body.metadata.domain) {
        body.metadata.domain = apiKeyData.domain;
      }
    }

    // Trigger webhooks for the event
    await triggerWebhooks(
      supabase,
      body.event,
      body.data,
      body.metadata
    );

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Webhooks triggered for event: ${body.event}`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Webhook trigger error:", error);
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