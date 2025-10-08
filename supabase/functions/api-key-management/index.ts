// Content Perfect API Key Management Service
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Create Supabase client
const supabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get the path and method
    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();
    
    // Route to appropriate function
    if (req.method === "GET" && path === "list") {
      return await listApiKeys(req);
    } else if (req.method === "POST" && path === "generate") {
      return await generateApiKey(req);
    } else if (req.method === "POST" && path === "revoke") {
      return await revokeApiKey(req);
    } else if (req.method === "POST" && path === "rotate") {
      return await rotateApiKey(req);
    } else {
      return new Response(
        JSON.stringify({ error: "Route not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (error) {
    console.error("Error processing request:", error);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * List API keys
 */
async function listApiKeys(req: Request) {
  try {
    // Check if we're filtering by domain
    const url = new URL(req.url);
    const domain = url.searchParams.get("domain");
    const clientId = url.searchParams.get("client_id");
    
    // Build query
    let query = supabaseClient
      .from("client_api_keys")
      .select(`
        id,
        client_id,
        domain,
        created_at,
        expires_at,
        is_active,
        last_used,
        usage_count,
        description,
        created_by,
        clients:client_id (
          name
        )
      `)
      .order("created_at", { ascending: false });
    
    // Apply filters if provided
    if (domain) {
      query = query.eq("domain", domain);
    }
    
    if (clientId) {
      query = query.eq("client_id", clientId);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Return the results, removing sensitive data
    return new Response(
      JSON.stringify({
        keys: data.map(key => ({
          id: key.id,
          client_id: key.client_id,
          client_name: key.clients?.name,
          domain: key.domain,
          created_at: key.created_at,
          expires_at: key.expires_at,
          is_active: key.is_active,
          last_used: key.last_used,
          usage_count: key.usage_count,
          description: key.description,
          created_by: key.created_by
        }))
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error listing API keys:", error);
    
    return new Response(
      JSON.stringify({
        error: "Error listing API keys",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Generate a new API key
 */
async function generateApiKey(req: Request) {
  try {
    // Parse request body
    const { domain, clientId, description, expiryDays } = await req.json();
    
    if (!domain || !clientId) {
      return new Response(
        JSON.stringify({ error: "Domain and clientId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Validate domain format
    if (!isValidDomain(domain)) {
      return new Response(
        JSON.stringify({ error: "Invalid domain format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Validate that the client exists
    const { data: client, error: clientError } = await supabaseClient
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .single();
    
    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Generate a secure random API key
    const apiKeyBuffer = await crypto.subtle.digest(
      "SHA-256",
      crypto.getRandomValues(new Uint8Array(32))
    );
    const apiKey = Array.from(new Uint8Array(apiKeyBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    
    // Hash the API key
    const keyHash = await bcrypt.hash(apiKey, 10);
    
    // Calculate expiry date if provided
    let expiresAt = null;
    if (expiryDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);
    }
    
    // Insert the new API key
    const { data, error } = await supabaseClient
      .from("client_api_keys")
      .insert({
        client_id: clientId,
        domain: domain.toLowerCase().trim(),
        api_key: apiKey,
        key_hash: keyHash,
        expires_at: expiresAt,
        description: description || `API key for ${domain}`,
        created_by: (await supabaseClient.auth.getUser()).data.user?.id
      })
      .select("id, created_at")
      .single();
    
    if (error) throw error;
    
    // Return the new key details
    return new Response(
      JSON.stringify({
        id: data.id,
        api_key: apiKey,  // Only time the raw key is returned
        domain: domain,
        client_id: clientId,
        created_at: data.created_at,
        expires_at: expiresAt,
        description: description || `API key for ${domain}`
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error generating API key:", error);
    
    return new Response(
      JSON.stringify({
        error: "Error generating API key",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Revoke an API key
 */
async function revokeApiKey(req: Request) {
  try {
    // Parse request body
    const { keyId } = await req.json();
    
    if (!keyId) {
      return new Response(
        JSON.stringify({ error: "API key ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Update the key to inactive
    const { data, error } = await supabaseClient
      .from("client_api_keys")
      .update({
        is_active: false
      })
      .eq("id", keyId)
      .select("id, domain, client_id")
      .single();
    
    if (error) throw error;
    
    if (!data) {
      return new Response(
        JSON.stringify({ error: "API key not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Return success
    return new Response(
      JSON.stringify({
        message: "API key revoked successfully",
        id: data.id,
        domain: data.domain,
        client_id: data.client_id
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error revoking API key:", error);
    
    return new Response(
      JSON.stringify({
        error: "Error revoking API key",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Rotate an API key
 */
async function rotateApiKey(req: Request) {
  try {
    // Parse request body
    const { keyId, gracePeriodDays = 7, description } = await req.json();
    
    if (!keyId) {
      return new Response(
        JSON.stringify({ error: "API key ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Get the current key details
    const { data: keyData, error: keyError } = await supabaseClient
      .from("client_api_keys")
      .select("id, domain, client_id, description")
      .eq("id", keyId)
      .eq("is_active", true)
      .single();
    
    if (keyError || !keyData) {
      return new Response(
        JSON.stringify({ error: "Active API key not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Set expiration on old key
    const graceEnd = new Date();
    graceEnd.setDate(graceEnd.getDate() + gracePeriodDays);
    
    const { error: updateError } = await supabaseClient
      .from("client_api_keys")
      .update({
        expires_at: graceEnd.toISOString()
      })
      .eq("id", keyId);
    
    if (updateError) throw updateError;
    
    // Generate a new key
    const apiKeyBuffer = await crypto.subtle.digest(
      "SHA-256",
      crypto.getRandomValues(new Uint8Array(32))
    );
    const apiKey = Array.from(new Uint8Array(apiKeyBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    
    // Hash the API key
    const keyHash = await bcrypt.hash(apiKey, 10);
    
    // Insert the new API key
    const { data: newKey, error: insertError } = await supabaseClient
      .from("client_api_keys")
      .insert({
        client_id: keyData.client_id,
        domain: keyData.domain,
        api_key: apiKey,
        key_hash: keyHash,
        description: description || `Rotated from key ${keyId}: ${keyData.description}`,
        created_by: (await supabaseClient.auth.getUser()).data.user?.id
      })
      .select("id, created_at")
      .single();
    
    if (insertError) throw insertError;
    
    // Return the new key details
    return new Response(
      JSON.stringify({
        message: "API key rotated successfully",
        old_key_id: keyId,
        old_key_expires_at: graceEnd.toISOString(),
        new_key_id: newKey.id,
        new_api_key: apiKey,  // Only time the raw key is returned
        domain: keyData.domain,
        client_id: keyData.client_id,
        created_at: newKey.created_at
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error rotating API key:", error);
    
    return new Response(
      JSON.stringify({
        error: "Error rotating API key",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * Validate domain format
 */
function isValidDomain(domain: string): boolean {
  // Simple domain validation regex
  const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}