// Content Perfect WordPress Publishing Service
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
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
    const url = new URL(req.url);
    const path = url.pathname;

    // Route to appropriate function
    if (path === "/wordpress-publisher" && req.method === "POST") {
      return await publishContent(req);
    } else if (path === "/wordpress-publisher/status" && req.method === "GET") {
      return await getStatus(req);
    } else if (path === "/wordpress-publisher/retry" && req.method === "POST") {
      return await processRetryQueue(req);
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
 * Publish content to WordPress
 */
async function publishContent(req: Request) {
  try {
    // Parse request body
    const { taskId } = await req.json();

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: "Task ID is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get task data
    const task = await getTaskById(taskId);
    
    if (!task) {
      return new Response(
        JSON.stringify({ error: "Task not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if task is completed
    if (task.status !== "Complete") {
      return new Response(
        JSON.stringify({ error: "Task is not completed" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if task already has a live post URL
    if (task.live_post_url) {
      return new Response(
        JSON.stringify({ 
          message: "Task already published", 
          url: task.live_post_url 
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Publish content to WordPress
    const result = await publishToWordPress(task);

    // Return the result
    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error publishing content:", error);

    return new Response(
      JSON.stringify({
        error: "Error publishing content",
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
 * Get publishing service status
 */
async function getStatus(req: Request) {
  try {
    // Get pending tasks count
    const { data: pendingTasks, error: pendingError } = await supabaseClient
      .from("tasks")
      .select("task_id", { count: "exact" })
      .eq("status", "Complete")
      .is("live_post_url", null);

    if (pendingError) throw pendingError;

    // Get recent publications
    const { data: recentPublications, error: recentError } = await supabaseClient
      .from("publication_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentError) throw recentError;

    // Get retry queue count
    const { data: retryQueue, error: retryError } = await supabaseClient
      .from("publication_retries")
      .select("task_id", { count: "exact" });

    if (retryError) throw retryError;
    
    // Get domains with post limits
    const { data: domainLimits, error: limitsError } = await supabaseClient
      .from("client_api_keys")
      .select("domain, monthly_post_limit, monthly_post_count")
      .gt("monthly_post_limit", 0)
      .eq("is_active", true);
      
    if (limitsError) throw limitsError;

    return new Response(
      JSON.stringify({
        status: "active",
        pendingTasksCount: pendingTasks.length,
        retryQueueCount: retryQueue.length,
        recentPublications: recentPublications,
        domainPostLimits: domainLimits || []
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error getting status:", error);

    return new Response(
      JSON.stringify({
        error: "Error getting status",
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
 * Process the retry queue
 */
async function processRetryQueue(req: Request) {
  try {
    // Get tasks due for retry
    const { data: retryTasks, error: retryError } = await supabaseClient
      .from("publication_retries")
      .select(`
        task_id,
        retry_count,
        tasks:task_id(
          title,
          content,
          client_name,
          client_domain,
          seo_keyword,
          meta_description,
          schema_data,
          hero_image_url
        )
      `)
      .lt("next_retry_at", new Date().toISOString())
      .lt("retry_count", 5)
      .limit(5);

    if (retryError) throw retryError;

    // Process each retry task
    const results = [];

    for (const retryTask of retryTasks) {
      try {
        // Get the task data
        const task = retryTask.tasks;
        task.task_id = retryTask.task_id;

        // Publish to WordPress
        const result = await publishToWordPress(task);
        
        // If successful, remove from retry queue
        if (result.success) {
          await supabaseClient
            .from("publication_retries")
            .delete()
            .eq("task_id", retryTask.task_id);
        }

        results.push({
          task_id: retryTask.task_id,
          result: result,
        });
      } catch (error) {
        console.error(`Retry failed for task ${retryTask.task_id}:`, error);
        
        results.push({
          task_id: retryTask.task_id,
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        processed: retryTasks.length,
        results: results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing retry queue:", error);

    return new Response(
      JSON.stringify({
        error: "Error processing retry queue",
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
 * Get task by ID
 */
async function getTaskById(taskId: string) {
  const { data, error } = await supabaseClient
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
    .eq("task_id", taskId)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Publish content to WordPress
 */
async function publishToWordPress(task: any) {
  try {
    // Get API key and post limit info for the domain
    const { data: keyInfo, error: keyInfoError } = await supabaseClient
      .rpc('get_api_key_info', {
        p_domain: task.client_domain
      });

    if (keyInfoError) throw keyInfoError;

    if (!keyInfo || keyInfo.length === 0) {
      throw new Error(`No active API key found for domain: ${task.client_domain}`);
    }

    const apiKey = keyInfo[0].api_key;
    const monthlyPostLimit = keyInfo[0].monthly_post_limit;
    const monthlyPostCount = keyInfo[0].monthly_post_count;
    
    // Check if monthly post limit has been reached
    if (monthlyPostLimit > 0 && monthlyPostCount >= monthlyPostLimit) {
      // Log the limit exceeded event
      await logPublication(task.task_id, "limit_exceeded", {
        message: `Monthly post limit of ${monthlyPostLimit} has been reached`,
        monthly_post_count: monthlyPostCount,
        monthly_post_limit: monthlyPostLimit
      });
      
      throw new Error(`Monthly post limit of ${monthlyPostLimit} has been reached for domain: ${task.client_domain}`);
    }

    // Prepare endpoint URL
    const endpoint = `https://${task.client_domain}/wp-json/content-perfect/v1/content`;

    // Process content for WordPress - Remove H1 tags AND embedded styles
    let processedContent = task.content || '';
    
    // Log original content stats
    const originalLength = processedContent.length;
    const hasH1 = /<h1[^>]*>/i.test(processedContent);
    const hasStyle = /<style[^>]*>/i.test(processedContent);
    const h1Count = (processedContent.match(/<h1[^>]*>/gi) || []).length;
    const styleCount = (processedContent.match(/<style[^>]*>/gi) || []).length;
    
    console.log(`Content processing - Original: ${originalLength} chars, H1: ${h1Count} tags, Style: ${styleCount} tags`);
    
    // 1. Remove ALL embedded style tags and their content
    processedContent = processedContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // 2. Remove ALL H1 tags and their content (WordPress themes generate H1 from post title)
    processedContent = processedContent.replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '');
    
    // 3. Clean up any orphaned closing tags
    processedContent = processedContent.replace(/<\/h1>/gi, '');
    processedContent = processedContent.replace(/<\/style>/gi, '');
    
    // 4. Remove empty paragraphs
    processedContent = processedContent.replace(/<p[^>]*>\s*<\/p>/gi, '');
    
    // 5. Clean up excessive whitespace
    processedContent = processedContent.replace(/\n\s*\n\s*\n/g, '\n\n');
    processedContent = processedContent.trim();
    
    // 6. Replace template/placeholder images with actual hero image if available
    if (task.hero_image_url) {
      console.log(`Replacing template images with hero image: ${task.hero_image_url}`);
      
      // Pattern to match img tags with common template/placeholder patterns
      // This matches images from loud.us/wp-content or any image with [TEMPLATE] in alt text
      const imgPattern = /<img\s+[^>]*src=["']([^"']*(?:loud\.us\/wp-content|placeholder|template)[^"']*|[^"']*)["'][^>]*alt=["'][^"']*(?:\[TEMPLATE\]|template|placeholder)[^"']*["'][^>]*>/gi;
      
      // Also match any standalone img tag that might be a hero/feature image (first img in content)
      const firstImgPattern = /<img\s+[^>]*src=["']([^"']*)["'][^>]*>/i;
      
      // Check if there's a template image to replace
      if (imgPattern.test(processedContent)) {
        // Replace template images with our hero image
        processedContent = processedContent.replace(imgPattern, (match, src) => {
          console.log(`Replacing template image: ${src}`);
          return `<img src="${task.hero_image_url}" alt="${task.title || 'Hero Image'}" style="width: 100%; height: auto; max-width: 100%; display: block;" loading="lazy">`;
        });
        console.log('Template images replaced with hero image');
      } else if (firstImgPattern.test(processedContent)) {
        // If no template image but there's an img tag at the start, replace the first one
        let replaced = false;
        processedContent = processedContent.replace(firstImgPattern, (match, src) => {
          if (!replaced && src && !src.includes('supabase')) { // Don't replace if already a supabase image
            console.log(`Replacing first image: ${src}`);
            replaced = true;
            return `<img src="${task.hero_image_url}" alt="${task.title || 'Hero Image'}" style="width: 100%; height: auto; max-width: 100%; display: block;" loading="lazy">`;
          }
          return match;
        });
        if (replaced) {
          console.log('First image replaced with hero image');
        }
      } else {
        // No existing image to replace, add hero image at the beginning
        console.log('No template image found, adding hero image to beginning of content');
        const heroImageHtml = `<img src="${task.hero_image_url}" alt="${task.title || 'Hero Image'}" style="width: 100%; height: auto; max-width: 100%; display: block; margin-bottom: 2rem;" loading="lazy">\n\n`;
        processedContent = heroImageHtml + processedContent;
      }
    }
    
    // Log processed content stats
    const processedLength = processedContent.length;
    const stillHasH1 = /<h1[^>]*>/i.test(processedContent);
    const stillHasStyle = /<style[^>]*>/i.test(processedContent);
    
    console.log(`Content processed - New: ${processedLength} chars, H1: ${stillHasH1 ? 'ERROR!' : 'removed'}, Style: ${stillHasStyle ? 'ERROR!' : 'removed'}`);
    console.log(`Removed ${originalLength - processedLength} characters`);

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

    // Make request to WordPress site
    const response = await axiod.post(endpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Monthly-Post-Limit": monthlyPostLimit.toString()
      },
      timeout: 30000, // 30 second timeout
    });

    // Handle response
    if (response.data.success) {
      // Update task with live post URL
      const { error: updateError } = await supabaseClient
        .from("tasks")
        .update({
          live_post_url: response.data.permalink,
          last_published_at: new Date().toISOString(),
        })
        .eq("task_id", task.task_id);

      if (updateError) throw updateError;

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

      return {
        success: true,
        task_id: task.task_id,
        post_url: response.data.permalink,
      };
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

    // Add to retry queue if appropriate
    if (shouldRetry(error)) {
      await addToRetryQueue(task.task_id);
    }

    throw error;
  }
}

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

/**
 * Determine if we should retry based on error type
 */
function shouldRetry(error: any): boolean {
  // Don't retry client errors (4xx) except for 429 (rate limiting)
  if (
    error.response &&
    error.response.status >= 400 &&
    error.response.status < 500
  ) {
    return error.response.status === 429;
  }

  // Retry server errors (5xx) and network errors
  return true;
}