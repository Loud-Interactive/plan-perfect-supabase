import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Edge function to delete/deactivate a webhook
 * DELETE /webhooks/delete/:webhook_id
 */

interface DeleteRequest {
  webhook_id?: string;
  webhook_url?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get API key from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const apiKey = authHeader.replace("Bearer ", "");

    // Parse request - can be DELETE with query params or body
    let webhookId: string | undefined;
    let webhookUrl: string | undefined;

    if (req.method === "DELETE") {
      const url = new URL(req.url);
      webhookId = url.searchParams.get("webhook_id") || undefined;
      webhookUrl = url.searchParams.get("webhook_url") || undefined;
    } else {
      const body: DeleteRequest = await req.json();
      webhookId = body.webhook_id;
      webhookUrl = body.webhook_url;
    }

    if (!webhookId && !webhookUrl) {
      return new Response(
        JSON.stringify({
          error: "Either webhook_id or webhook_url must be provided"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate API key
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from("api_keys_domains")
      .select("*")
      .eq("api_key", apiKey)
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

    // Build query to find webhook
    let query = supabase
      .from("webhooks")
      .select("*")
      .eq("api_key_domain_id", apiKeyData.id);

    if (webhookId) {
      query = query.eq("id", webhookId);
    } else if (webhookUrl) {
      query = query.eq("webhook_url", webhookUrl);
    }

    const { data: webhook, error: findError } = await query.single();

    if (findError || !webhook) {
      return new Response(
        JSON.stringify({ error: "Webhook not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Soft delete - set is_active to false
    const { error: updateError } = await supabase
      .from("webhooks")
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", webhook.id);

    if (updateError) {
      console.error("Error deactivating webhook:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to deactivate webhook" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: "Webhook deactivated successfully",
        webhook_id: webhook.id,
        webhook_url: webhook.webhook_url
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Webhook delete error:", error);
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