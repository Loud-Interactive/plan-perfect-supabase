import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { corsHeaders } from "../_shared/cors.ts";

interface WebhookRegistrationRequest {
  webhook_url: string;
  email: string;
  events: string[];
  secret: string;
}

interface ApiKeyDomain {
  id: string;
  api_key: string;
  domain: string;
  is_active: boolean;
}

const VALID_EVENTS = [
  "content_started",
  "content_progress",
  "content_complete",
  "content_error",
  "outline_generated",
  "research_complete",
  "draft_complete",
  "qa_complete"
];

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

    // Parse request body
    const body: WebhookRegistrationRequest = await req.json();

    // Validate required fields
    if (!body.webhook_url || !body.email || !body.events || !body.secret) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: webhook_url, email, events, and secret are required"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Validate webhook URL
    try {
      const webhookUrl = new URL(body.webhook_url);
      if (!webhookUrl.protocol.startsWith("https")) {
        return new Response(
          JSON.stringify({ error: "Webhook URL must use HTTPS" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Invalid webhook URL format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Validate events
    const invalidEvents = body.events.filter(event => !VALID_EVENTS.includes(event));
    if (invalidEvents.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Invalid events: ${invalidEvents.join(", ")}`,
          valid_events: VALID_EVENTS
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

    // Extract domain from webhook URL
    const webhookDomain = new URL(body.webhook_url).hostname;

    // Validate API key and domain pair
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

    // Check if the webhook domain is authorized
    // Use authorized_domains array if available, otherwise fall back to domain field
    const authorizedDomains = apiKeyData.authorized_domains || [apiKeyData.domain];

    const isDomainAuthorized = authorizedDomains.some((authorizedDomain: string) => {
      // Allow exact match or subdomain
      return webhookDomain === authorizedDomain ||
             webhookDomain.endsWith('.' + authorizedDomain);
    });

    if (!isDomainAuthorized) {
      return new Response(
        JSON.stringify({
          error: `API key is not authorized for domain: ${webhookDomain}. Authorized domains: ${authorizedDomains.join(', ')}`
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Check if webhook already exists for this API key and URL
    const { data: existingWebhook } = await supabase
      .from("webhooks")
      .select("id")
      .eq("api_key_domain_id", apiKeyData.id)
      .eq("webhook_url", body.webhook_url)
      .single();

    let webhookId: string;

    if (existingWebhook) {
      // Update existing webhook
      const { data: updatedWebhook, error: updateError } = await supabase
        .from("webhooks")
        .update({
          email: body.email,
          events: body.events,
          secret: body.secret,
          updated_at: new Date().toISOString(),
          is_active: true
        })
        .eq("id", existingWebhook.id)
        .select()
        .single();

      if (updateError) {
        console.error("Error updating webhook:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update webhook" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      webhookId = updatedWebhook.id;
    } else {
      // Create new webhook
      const { data: newWebhook, error: insertError } = await supabase
        .from("webhooks")
        .insert({
          api_key_domain_id: apiKeyData.id,
          webhook_url: body.webhook_url,
          email: body.email,
          events: body.events,
          secret: body.secret,
          domain: webhookDomain,
          is_active: true
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error creating webhook:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to create webhook" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      webhookId = newWebhook.id;
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: existingWebhook ? "Webhook updated successfully" : "Webhook registered successfully",
        webhook_id: webhookId,
        events: body.events,
        webhook_url: body.webhook_url
      }),
      {
        status: existingWebhook ? 200 : 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Webhook registration error:", error);
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