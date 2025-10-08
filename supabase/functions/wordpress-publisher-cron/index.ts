// Content Perfect WordPress Publishing Cron Job
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

// Maximum number of tasks to process in one run
const MAX_TASKS = 20;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse request for any parameters
    const { limit, dryRun, newest } = await req.json().catch(() => ({ 
      limit: MAX_TASKS, 
      dryRun: false,
      newest: true // Default to processing newest tasks first
    }));
    
    // Use provided limit or default
    const taskLimit = limit && limit <= MAX_TASKS ? limit : MAX_TASKS;
    
    console.log(`Starting WordPress publishing job, limit: ${taskLimit}, newest first: ${newest}, dry run: ${dryRun}`);

    // Process completed tasks
    const result = await processCompletedTasks(taskLimit, dryRun, newest);
    
    // Process retry queue
    const retryResult = await processRetryQueue(taskLimit, dryRun);
    
    // Return the results
    return new Response(
      JSON.stringify({
        success: true,
        processed: result.processed,
        results: result.results,
        retryProcessed: retryResult.processed,
        retryResults: retryResult.results,
        timestamp: new Date().toISOString(),
        config: {
          limit: taskLimit,
          newest_first: newest,
          dry_run: dryRun
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in cron job:", error);

    return new Response(
      JSON.stringify({
        error: "Error in cron job",
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
 * Process completed tasks
 */
async function processCompletedTasks(limit: number, dryRun: boolean, newest: boolean = true) {
  try {
    // Get completed tasks without live_post_url
    const query = supabaseClient
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
        last_updated_at
      `)
      .eq("status", "Complete")
      .is("live_post_url", null);
      
    // Order by last_updated_at, either newest or oldest first
    if (newest) {
      query.order("last_updated_at", { ascending: false }); // Process newest tasks first
    } else {
      query.order("last_updated_at", { ascending: true }); // Process oldest tasks first
    }
    
    // Limit the number of tasks
    const { data: tasks, error } = await query.limit(limit);

    if (error) throw error;

    console.log(`Found ${tasks.length} completed tasks to process`);
    
    // Process each task
    const results = [];
    
    if (dryRun) {
      // In dry run mode, just return the tasks that would be processed
      return {
        processed: tasks.length,
        results: tasks.map(task => ({
          task_id: task.task_id,
          title: task.title,
          domain: task.client_domain,
          last_updated_at: task.last_updated_at,
          dry_run: true
        }))
      };
    }
    
    for (const task of tasks) {
      try {
        // Call the publishing function
        const result = await publishTask(task);
        const resultWithTimestamp = {
          ...result,
          last_updated_at: task.last_updated_at
        };
        results.push(resultWithTimestamp);
      } catch (error) {
        console.error(`Error publishing task ${task.task_id}:`, error);
        
        results.push({
          task_id: task.task_id,
          error: error.message,
          last_updated_at: task.last_updated_at
        });
        
        // Log the error
        await logPublication(task.task_id, "error", {
          message: error.message,
          details: error.response?.data || {}
        });
        
        // Add to retry queue if appropriate
        if (shouldRetry(error)) {
          await addToRetryQueue(task.task_id);
        }
      }
    }

    return {
      processed: tasks.length,
      results: results
    };
  } catch (error) {
    console.error("Error processing completed tasks:", error);
    throw error;
  }
}

/**
 * Process the retry queue
 */
async function processRetryQueue(limit: number, dryRun: boolean) {
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
      .order("next_retry_at", { ascending: true })
      .limit(limit);

    if (retryError) throw retryError;

    console.log(`Found ${retryTasks.length} tasks in retry queue to process`);

    // Process each retry task
    const results = [];
    
    if (dryRun) {
      // In dry run mode, just return the tasks that would be processed
      return {
        processed: retryTasks.length,
        results: retryTasks.map(retryTask => ({
          task_id: retryTask.task_id,
          retry_count: retryTask.retry_count,
          domain: retryTask.tasks.client_domain,
          dry_run: true
        }))
      };
    }

    for (const retryTask of retryTasks) {
      try {
        // Get the task data
        const task = retryTask.tasks;
        task.task_id = retryTask.task_id;

        // Publish to WordPress
        const result = await publishTask(task);
        
        // If successful, remove from retry queue
        if (result.success) {
          await supabaseClient
            .from("publication_retries")
            .delete()
            .eq("task_id", retryTask.task_id);
        }

        results.push({
          task_id: retryTask.task_id,
          retry_count: retryTask.retry_count,
          result: result
        });
      } catch (error) {
        console.error(`Retry failed for task ${retryTask.task_id}:`, error);
        
        results.push({
          task_id: retryTask.task_id,
          retry_count: retryTask.retry_count,
          error: error.message
        });
        
        // Update retry count and next retry time
        await updateRetryCount(retryTask.task_id, retryTask.retry_count);
      }
    }

    return {
      processed: retryTasks.length,
      results: results
    };
  } catch (error) {
    console.error("Error processing retry queue:", error);
    throw error;
  }
}

/**
 * Publish a task to WordPress
 */
async function publishTask(task: any) {
  try {
    // Get API key for the domain
    const { data: apiKeys, error: apiKeyError } = await supabaseClient
      .from("client_api_keys")
      .select("api_key")
      .eq("domain", task.client_domain)
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(1);

    if (apiKeyError) throw apiKeyError;

    if (!apiKeys.length) {
      throw new Error(`No active API key found for domain: ${task.client_domain}`);
    }

    const apiKey = apiKeys[0].api_key;

    // Prepare endpoint URL
    const endpoint = `https://${task.client_domain}/wp-json/content-perfect/v1/content`;

    // Extract categories and tags if available (not implemented yet)
    const categories = [];
    const tags = [];

    // Prepare request payload
    const payload = {
      task_id: task.task_id,
      title: task.title,
      content: task.content,
      seo_keyword: task.seo_keyword,
      meta_description: task.meta_description,
      schema_data: task.schema_data,
      hero_image_url: task.hero_image_url,
      categories,
      tags
    };

    // Make request to WordPress site
    const response = await axiod.post(endpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      },
      timeout: 60000 // 60 second timeout
    });

    // Handle response
    if (response.data.success) {
      // Update task with live post URL
      const { error: updateError } = await supabaseClient
        .from("tasks")
        .update({
          live_post_url: response.data.permalink,
          last_published_at: new Date().toISOString()
        })
        .eq("task_id", task.task_id);

      if (updateError) throw updateError;

      // Log successful publication
      await logPublication(task.task_id, "success", response.data);

      // Update API key usage
      await updateApiKeyUsage(task.client_domain);

      return {
        success: true,
        task_id: task.task_id,
        post_url: response.data.permalink,
        status: response.data.status
      };
    } else {
      throw new Error("Publication failed: " + JSON.stringify(response.data));
    }
  } catch (error) {
    // Let the caller handle the error
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
      details: details
    });

  if (error) {
    console.error("Error logging publication:", error);
  }
}

/**
 * Update API key usage counter
 */
async function updateApiKeyUsage(domain: string) {
  const { error } = await supabaseClient
    .rpc("update_api_key_usage", { 
      p_domain: domain
    });

  if (error) {
    console.error("Error updating API key usage:", error);
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
    retryCount = retryResult.retry_count;
  }

  await updateRetryCount(taskId, retryCount);
}

/**
 * Update retry count and next retry time
 */
async function updateRetryCount(taskId: string, currentRetryCount: number) {
  // Increment retry count
  const retryCount = currentRetryCount + 1;
  
  // Calculate next retry time with exponential backoff
  const baseDelay = 5 * 60 * 1000; // 5 minutes
  const maxDelay = 24 * 60 * 60 * 1000; // 24 hours

  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const nextRetryAt = new Date(Date.now() + delay);

  // Update or insert retry record
  const { data: retryExists, error: checkError } = await supabaseClient
    .from("publication_retries")
    .select("task_id")
    .eq("task_id", taskId);

  if (checkError) {
    console.error("Error checking retry record:", checkError);
    return;
  }

  if (retryExists && retryExists.length > 0) {
    // Update existing record
    const { error: updateError } = await supabaseClient
      .from("publication_retries")
      .update({
        retry_count: retryCount,
        next_retry_at: nextRetryAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("task_id", taskId);

    if (updateError) {
      console.error("Error updating retry record:", updateError);
    }
  } else {
    // Insert new record
    const { error: insertError } = await supabaseClient
      .from("publication_retries")
      .insert({
        task_id: taskId,
        retry_count: retryCount,
        next_retry_at: nextRetryAt.toISOString()
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