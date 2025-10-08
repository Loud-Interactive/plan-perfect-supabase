// Manage Shopify Settings in Pairs Table
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Create Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// Define Shopify settings structure
interface ShopifySettings {
  domain: string;
  client_id?: string; // Optional client_id for shopify_configs table
  shopify_admin_api_access_token?: string;
  shopify_blog_id?: string;
  shopify_blog_url?: string;
  shopify_post_author_name?: string;
  shopify_post_title_suffix?: string;
  shopify_store_domain?: string;
  shopify_template?: string;
  enable_auto_publish?: boolean; // Enable automatic publishing to Shopify
}

// Required fields for Shopify configuration
const REQUIRED_FIELDS = [
  'shopify_admin_api_access_token',
  'shopify_blog_id',
  'shopify_store_domain'
];

// Default values for optional fields
const DEFAULT_VALUES = {
  shopify_post_author_name: "Brent Payne",
  shopify_template: "seo-article",
  shopify_post_title_suffix: ""
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle GET request to retrieve settings
    if (req.method === "GET" && path === "/manage-shopify-settings") {
      const domain = url.searchParams.get("domain");
      
      if (!domain) {
        return new Response(
          JSON.stringify({ error: "Domain parameter is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return await getShopifySettings(domain);
    }

    // Handle POST/PUT request to create/update settings
    if ((req.method === "POST" || req.method === "PUT") && path === "/manage-shopify-settings") {
      const body = await req.json();
      
      if (!body.domain) {
        return new Response(
          JSON.stringify({ error: "Domain field is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return await upsertShopifySettings(body);
    }

    // Handle DELETE request to remove settings
    if (req.method === "DELETE" && path === "/manage-shopify-settings") {
      const domain = url.searchParams.get("domain");
      
      if (!domain) {
        return new Response(
          JSON.stringify({ error: "Domain parameter is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return await deleteShopifySettings(domain);
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// Get Shopify settings for a domain
async function getShopifySettings(domain: string) {
  try {
    console.log(`Fetching Shopify settings for domain: ${domain}`);

    // Fetch all Shopify-related pairs and automated_client_id for the domain
    const { data, error } = await supabaseClient
      .from("pairs")
      .select("key, value")
      .eq("domain", domain)
      .or("key.like.shopify_%,key.eq.automated_client_id");

    if (error) {
      throw error;
    }

    // Convert array of key-value pairs to object
    const settings: Record<string, string> = { domain };
    
    if (data && data.length > 0) {
      data.forEach(pair => {
        settings[pair.key] = pair.value;
      });
    }

    // Check if any settings were found
    const hasSettings = Object.keys(settings).length > 1;

    return new Response(
      JSON.stringify({
        success: true,
        domain,
        has_settings: hasSettings,
        settings: hasSettings ? settings : null,
        message: hasSettings ? "Settings retrieved successfully" : "No Shopify settings found for this domain"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error fetching settings:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch settings", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

// Create or update Shopify settings
async function upsertShopifySettings(settings: ShopifySettings) {
  try {
    const { domain, client_id, enable_auto_publish, ...shopifySettings } = settings;
    
    console.log(`Upserting Shopify settings for domain: ${domain}`);

    // Validate required fields
    const missingFields = [];
    for (const field of REQUIRED_FIELDS) {
      if (!shopifySettings[field]) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields",
          missing_fields: missingFields,
          required_fields: REQUIRED_FIELDS
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate access token format (should start with 'shpat_')
    if (shopifySettings.shopify_admin_api_access_token && 
        !shopifySettings.shopify_admin_api_access_token.startsWith('shpat_')) {
      return new Response(
        JSON.stringify({
          error: "Invalid access token format",
          details: "Shopify access token should start with 'shpat_'"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Apply default values for optional fields
    const settingsWithDefaults = {
      ...DEFAULT_VALUES,
      ...shopifySettings
    };

    // Prepare upsert operations for each setting
    const upsertPromises = [];
    const processedSettings = [];

    // Add client_id as automated_client_id if provided
    if (client_id) {
      const clientIdData = {
        domain,
        key: 'automated_client_id',
        value: String(client_id)
      };
      
      // Check if automated_client_id already exists
      const { data: existingClientId } = await supabaseClient
        .from("pairs")
        .select("id")
        .eq("domain", domain)
        .eq("key", "automated_client_id")
        .maybeSingle();
      
      let promise;
      if (existingClientId) {
        // Update existing
        promise = supabaseClient
          .from("pairs")
          .update({ value: String(client_id) })
          .eq("domain", domain)
          .eq("key", "automated_client_id")
          .select();
      } else {
        // Insert new
        promise = supabaseClient
          .from("pairs")
          .insert(clientIdData)
          .select();
      }
      
      upsertPromises.push(promise);
      processedSettings.push({ key: 'automated_client_id', value: String(client_id) });
    }

    for (const [key, value] of Object.entries(settingsWithDefaults)) {
      if (key.startsWith('shopify_') && value !== undefined && value !== null) {
        // Prepare the upsert data
        const upsertData = {
          domain,
          key,
          value: String(value) // Ensure value is a string
        };

        // Perform upsert (insert or update on conflict)
        // First check if the entry exists
        const { data: existing } = await supabaseClient
          .from("pairs")
          .select("id")
          .eq("domain", domain)
          .eq("key", key)
          .maybeSingle();
        
        let promise;
        if (existing) {
          // Update existing
          promise = supabaseClient
            .from("pairs")
            .update({ value: String(value) })
            .eq("domain", domain)
            .eq("key", key)
            .select();
        } else {
          // Insert new
          promise = supabaseClient
            .from("pairs")
            .insert(upsertData)
            .select();
        }

        upsertPromises.push(promise);
        processedSettings.push({ key, value: String(value) });
      }
    }

    // Execute all upserts
    const results = await Promise.all(upsertPromises);

    // Check for any errors
    const errors = results.filter(r => r.error).map(r => r.error);
    if (errors.length > 0) {
      throw new Error(`Failed to save some settings: ${errors.map(e => e.message).join(', ')}`);
    }

    // Log successful creation/update
    console.log(`Successfully upserted ${processedSettings.length} settings for domain: ${domain}`);

    // If client_id is provided, also create/update shopify_configs table
    let configResult = null;
    if (client_id) {
      console.log(`Creating/updating shopify_configs for client_id: ${client_id}`);
      
      // Check if a shopify_configs entry exists for this client
      const { data: existingConfig } = await supabaseClient
        .from("shopify_configs")
        .select("id")
        .eq("client_id", client_id)
        .maybeSingle();
      
      // Prepare config data
      const configData = {
        client_id,
        client_domain: domain,
        shopify_domain: shopifySettings.shopify_store_domain || domain,
        shopify_access_token: shopifySettings.shopify_admin_api_access_token,
        shopify_blog_id: shopifySettings.shopify_blog_id,
        shopify_template: settingsWithDefaults.shopify_template || "seo-article",
        shopify_post_author: settingsWithDefaults.shopify_post_author_name || "Brent Payne",
        shopify_post_suffix: settingsWithDefaults.shopify_post_title_suffix || "",
        active: enable_auto_publish !== false, // Default to true if not specified
        updated_at: new Date().toISOString()
      };
      
      if (existingConfig) {
        // Update existing config
        const { data: updatedConfig, error: updateError } = await supabaseClient
          .from("shopify_configs")
          .update(configData)
          .eq("id", existingConfig.id)
          .select()
          .single();
        
        if (updateError) {
          console.error("Error updating shopify_configs:", updateError);
        } else {
          configResult = { action: "updated", config: updatedConfig };
        }
      } else {
        // Insert new config
        const { data: newConfig, error: insertError } = await supabaseClient
          .from("shopify_configs")
          .insert({
            ...configData,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (insertError) {
          console.error("Error inserting into shopify_configs:", insertError);
        } else {
          configResult = { action: "created", config: newConfig };
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        domain,
        settings_saved: processedSettings.length,
        settings: Object.fromEntries(
          processedSettings.map(s => [s.key, s.value])
        ),
        shopify_config: configResult,
        message: configResult 
          ? `Shopify settings saved and config ${configResult.action} successfully`
          : "Shopify settings saved successfully (no client_id provided for config table)"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error upserting settings:", error);
    return new Response(
      JSON.stringify({ error: "Failed to save settings", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

// Delete Shopify settings for a domain
async function deleteShopifySettings(domain: string) {
  try {
    console.log(`Deleting Shopify settings for domain: ${domain}`);

    // Delete all Shopify-related pairs for the domain
    const { data, error } = await supabaseClient
      .from("pairs")
      .delete()
      .eq("domain", domain)
      .like("key", "shopify_%")
      .select();

    if (error) {
      throw error;
    }

    const deletedCount = data ? data.length : 0;

    return new Response(
      JSON.stringify({
        success: true,
        domain,
        deleted_count: deletedCount,
        message: deletedCount > 0 
          ? `Deleted ${deletedCount} Shopify settings for ${domain}` 
          : `No Shopify settings found to delete for ${domain}`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error deleting settings:", error);
    return new Response(
      JSON.stringify({ error: "Failed to delete settings", details: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}