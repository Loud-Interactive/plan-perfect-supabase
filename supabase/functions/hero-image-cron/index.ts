// Content Perfect Hero Image Scheduled Job
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";

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

// Function to call the batch hero image generator
async function processBatchHeroImages(limit: number) {
  // Get the base URL for the Supabase project
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  
  // Construct the URL for the batch hero image generator function
  const functionUrl = `${baseUrl}/functions/v1/batch-generate-hero-images`;
  
  // Get the service role key for internal function calls
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  
  try {
    // Call the batch function
    const response = await axiod.post(
      functionUrl,
      { limit: limit },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error("Error calling batch hero image generator:", error);
    throw error;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const authHeader = req.headers.get("Authorization");
    
    // Check for cron job invocation with proper authorization
    const isCronJob = url.searchParams.get("cron") === "true";
    const isAuthorized = 
      authHeader && 
      authHeader.startsWith("Bearer ") && 
      authHeader.split(" ")[1] === Deno.env.get("CRON_SECRET");
    
    // Process request params
    let limit = 10; // Default limit
    
    if (req.method === "POST") {
      const { limit: requestLimit } = await req.json();
      if (requestLimit && !isNaN(parseInt(requestLimit))) {
        limit = parseInt(requestLimit);
      }
    } else if (req.method === "GET") {
      const requestLimit = url.searchParams.get("limit");
      if (requestLimit && !isNaN(parseInt(requestLimit))) {
        limit = parseInt(requestLimit);
      }
    }
    
    // Basic authorization check for non-cron invocations
    if (!isCronJob) {
      // Check if the request is coming from a logged-in user with appropriate permissions
      const authUser = await supabaseClient.auth.getUser(
        authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : ""
      );
      
      if (authUser.error || !authUser.data?.user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else if (!isAuthorized) {
      // If it claims to be a cron job but doesn't have the right secret
      return new Response(
        JSON.stringify({ error: "Unauthorized cron request" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    console.log(`Starting hero image generation job with limit: ${limit}`);
    
    // Call the batch hero image generation function
    const result = await processBatchHeroImages(limit);
    
    // Log the completion
    console.log(`Hero image generation job completed: ${result.success_count} successful, ${result.error_count} failed`);
    
    // Return the result
    return new Response(
      JSON.stringify({
        success: true,
        message: "Hero image generation job completed",
        started_at: new Date().toISOString(),
        results: result
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error running hero image cron job:", error);
    
    return new Response(
      JSON.stringify({
        error: "Error running hero image generation job",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});