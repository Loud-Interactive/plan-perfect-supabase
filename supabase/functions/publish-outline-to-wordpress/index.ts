// Content Perfect Publish Outline to WordPress Service
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse request body
    const { guid } = await req.json();

    if (!guid) {
      return new Response(
        JSON.stringify({ error: "Content plan outline GUID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Received request to publish outline with GUID: ${guid}`);
    
    // Step 1: Find the task associated with this outline GUID
    const { data: tasks, error: taskError } = await supabaseClient
      .from("tasks")
      .select(`
        task_id,
        status,
        title,
        content,
        client_name,
        client_domain,
        seo_keyword,
        meta_description,
        schema_data,
        hero_image_url,
        live_post_url
      `)
      .eq("content_plan_outline_guid", guid)
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (taskError) {
      console.error("Error fetching task:", taskError);
      return new Response(
        JSON.stringify({ 
          error: "Error fetching task for the outline", 
          details: taskError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "No task found for this outline GUID",
          details: "A task needs to be created for this outline before publishing to WordPress"
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    const task = tasks[0];
    console.log(`Found task for outline: ${task.task_id}, domain: ${task.client_domain}`);
    
    // Step 2: Check if task is already published
    if (task.live_post_url) {
      return new Response(
        JSON.stringify({ 
          message: "Content already published to WordPress", 
          url: task.live_post_url,
          task_id: task.task_id
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Step 3: Check if the task status is "Complete"
    if (task.status !== "Complete") {
      return new Response(
        JSON.stringify({ 
          error: "Task is not ready for publishing", 
          details: `Current task status is "${task.status}". Only completed tasks can be published.`
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Step 4: Check if the domain has a WordPress API key and get limit info
    const { data: keyInfo, error: keyInfoError } = await supabaseClient
      .rpc('get_api_key_info', {
        p_domain: task.client_domain
      });

    if (keyInfoError) {
      console.error("Error fetching API key:", keyInfoError);
      return new Response(
        JSON.stringify({ 
          error: "Error fetching API key", 
          details: keyInfoError.message
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!keyInfo || keyInfo.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: `No WordPress API key found for domain: ${task.client_domain}`,
          details: "This domain is not configured for WordPress publishing"
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    const apiKey = keyInfo[0].api_key;
    const monthlyPostLimit = keyInfo[0].monthly_post_limit;
    const monthlyPostCount = keyInfo[0].monthly_post_count;
    
    // Check if monthly post limit has been reached
    if (monthlyPostLimit > 0 && monthlyPostCount >= monthlyPostLimit) {
      return new Response(
        JSON.stringify({ 
          error: `Monthly post limit of ${monthlyPostLimit} has been reached for domain: ${task.client_domain}`,
          details: `Current count: ${monthlyPostCount}, Limit: ${monthlyPostLimit}. Please try again next month.`,
          limit_exceeded: true
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Step 5: Publish the content to WordPress
    try {
      // Prepare endpoint URL
      const endpoint = `https://${task.client_domain}/wp-json/content-perfect/v1/content`;
      
      // Process content to replace template images with hero image
      let processedContent = task.content || '';
      
      // Replace template/placeholder images with actual hero image if available
      if (task.hero_image_url && processedContent) {
        console.log(`Processing content to replace images with hero image: ${task.hero_image_url}`);
        
        // Pattern to match the lead-image div and capture its contents
        // This will match <div class="lead-image"> with ANY content inside
        const leadImageDivPattern = /<div\s+class=["']lead-image["']>([\s\S]*?)<\/div>/gi;
        
        // Check if there's a lead-image div
        const hasLeadImageDiv = leadImageDivPattern.test(processedContent);
        
        if (hasLeadImageDiv) {
          // Reset the regex lastIndex after test
          leadImageDivPattern.lastIndex = 0;
          
          // Replace the lead-image div, keeping the div but replacing any img inside
          processedContent = processedContent.replace(leadImageDivPattern, (match, innerContent) => {
            console.log(`Found lead-image div with content: ${innerContent.substring(0, 100)}...`);
            
            // Check if there's an img tag inside
            if (/<img\s+[^>]*>/i.test(innerContent)) {
              // Replace any img tag(s) inside with our hero image
              const newImg = `<img src="${task.hero_image_url}" alt="${task.title || 'Hero Image'}" style="width: 100%; height: auto; max-width: 100%; display: block;" loading="lazy">`;
              console.log(`Replacing image in lead-image div with hero image`);
              return `<div class="lead-image">${newImg}</div>`;
            } else {
              // No img found, add our hero image
              console.log(`No image found in lead-image div, adding hero image`);
              const newImg = `<img src="${task.hero_image_url}" alt="${task.title || 'Hero Image'}" style="width: 100%; height: auto; max-width: 100%; display: block;" loading="lazy">`;
              return `<div class="lead-image">${newImg}</div>`;
            }
          });
          console.log('Lead-image div processed and hero image inserted');
        } else {
          // No lead-image div found, check for any template images to replace
          console.log('No lead-image div found, checking for template images');
          
          // Pattern to match any img tag with [TEMPLATE] in alt text or loud.us/wp-content in src
          const templateImgPattern = /<img\s+[^>]*(?:src=["'][^"']*loud\.us\/wp-content[^"']*["']|alt=["'][^"']*\[TEMPLATE\][^"']*["'])[^>]*>/gi;
          
          if (templateImgPattern.test(processedContent)) {
            // Replace template images
            processedContent = processedContent.replace(templateImgPattern, (match) => {
              console.log(`Replacing template image`);
              return `<img src="${task.hero_image_url}" alt="${task.title || 'Hero Image'}" style="width: 100%; height: auto; max-width: 100%; display: block;" loading="lazy">`;
            });
            console.log('Template images replaced with hero image');
          }
        }
      }
      
      // Prepare request payload
      const payload = {
        task_id: task.task_id,
        title: task.title,
        content: processedContent,
        seo_keyword: task.seo_keyword,
        meta_description: task.meta_description,
        schema_data: task.schema_data,
        hero_image_url: task.hero_image_url,
      };
      
      console.log(`Publishing to WordPress: ${endpoint}`);
      
      // Make request to WordPress site
      const response = await axiod.post(endpoint, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Monthly-Post-Limit": monthlyPostLimit.toString()
        },
        timeout: 60000, // 60 second timeout
      });
      
      // Handle response
      if (response.data.success) {
        console.log("WordPress publishing succeeded");
        
        // Update task with live post URL
        const { error: updateError } = await supabaseClient
          .from("tasks")
          .update({
            live_post_url: response.data.permalink,
            last_published_at: new Date().toISOString(),
          })
          .eq("task_id", task.task_id);
        
        if (updateError) {
          console.error("Error updating task with live URL:", updateError);
        }
        
        // Increment the monthly post count for this domain
        const { data: newCount, error: countError } = await supabaseClient
          .rpc('increment_api_key_post_count', {
            p_domain: task.client_domain
          });
        
        if (countError) {
          console.error("Error incrementing post count:", countError);
        }
        
        // Log successful publication
        await logPublication(task.task_id, "success", {
          ...response.data,
          monthly_post_count: newCount || monthlyPostCount + 1,
          monthly_post_limit: monthlyPostLimit
        });
        
        // Return the result
        return new Response(
          JSON.stringify({
            success: true,
            task_id: task.task_id,
            post_url: response.data.permalink,
            status: response.data.status || "published"
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      } else {
        throw new Error("Publication failed: " + JSON.stringify(response.data));
      }
    } catch (error) {
      console.error(`Error publishing task ${task.task_id}:`, error);
      
      // Log error
      await logPublication(task.task_id, "error", {
        message: error.message,
        details: error.response?.data || {},
      });
      
      // Add to retry queue
      await addToRetryQueue(task.task_id);
      
      return new Response(
        JSON.stringify({
          error: "Error publishing to WordPress",
          details: error.message,
          task_id: task.task_id
        }),
        {
          status: 500,
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
 * Log publication attempt
 */
async function logPublication(taskId: string, status: string, details: any) {
  const { error } = await supabaseClient
    .from("publication_logs")
    .insert({
      task_id: taskId,
      status: status,
      details: details,
    });

  if (error) {
    console.error("Error logging publication:", error);
  }
}

/**
 * Add task to retry queue
 */
async function addToRetryQueue(taskId: string) {
  // Get current retry count
  const { data: retryResult, error: retryError } = await supabaseClient
    .from("publication_retries")
    .select("retry_count, next_retry_at")
    .eq("task_id", taskId)
    .single();

  if (retryError && retryError.code !== "PGRST116") {
    // PGRST116 means no rows returned, which is expected for first retry
    console.error("Error checking retry count:", retryError);
    return;
  }

  let retryCount = 0;
  if (retryResult) {
    retryCount = retryResult.retry_count + 1;
  }

  // Calculate next retry time with exponential backoff
  const baseDelay = 5 * 60 * 1000; // 5 minutes
  const maxDelay = 24 * 60 * 60 * 1000; // 24 hours

  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const nextRetryAt = new Date(Date.now() + delay);

  // Update or insert retry record
  if (retryResult) {
    const { error: updateError } = await supabaseClient
      .from("publication_retries")
      .update({
        retry_count: retryCount,
        next_retry_at: nextRetryAt.toISOString(),
      })
      .eq("task_id", taskId);

    if (updateError) {
      console.error("Error updating retry record:", updateError);
    }
  } else {
    const { error: insertError } = await supabaseClient
      .from("publication_retries")
      .insert({
        task_id: taskId,
        retry_count: retryCount,
        next_retry_at: nextRetryAt.toISOString(),
      });

    if (insertError) {
      console.error("Error inserting retry record:", insertError);
    }
  }
}