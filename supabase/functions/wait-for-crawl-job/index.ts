// PagePerfect: wait-for-crawl-job
// Function to wait for a crawl job to complete
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  jobId: string;
  maxWaitTimeMs?: number; // Maximum time to wait in milliseconds
  pollingIntervalMs?: number; // How often to check status in milliseconds
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Supabase URL and service role key from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    }
    
    // Parse request body
    const { jobId, maxWaitTimeMs = 180000, pollingIntervalMs = 5000 } = await req.json() as RequestBody;
    
    if (!jobId) {
      throw new Error('jobId is required');
    }
    
    console.log(`Waiting for crawl job ${jobId} to complete (max wait: ${maxWaitTimeMs}ms, polling: ${pollingIntervalMs}ms)`);
    
    // Start timing
    const startTime = Date.now();
    let job = null;
    let isComplete = false;
    
    // Poll until job completes or timeout
    while (!isComplete && (Date.now() - startTime) < maxWaitTimeMs) {
      // Fetch current job status
      const response = await fetch(`${supabaseUrl}/functions/v1/get-crawl-job?jobId=${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get job status: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`Error getting job status: ${result.error}`);
      }
      
      job = result.job;
      
      // Check if job is complete
      if (job.status === 'completed') {
        isComplete = true;
        console.log(`Job ${jobId} completed successfully`);
      } else if (job.status === 'error') {
        throw new Error(`Job ${jobId} failed with error: ${job.error}`);
      } else {
        // Job still processing, wait and check again
        console.log(`Job ${jobId} status: ${job.status}. Waiting ${pollingIntervalMs}ms before checking again...`);
        await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
      }
    }
    
    // Check if we timed out
    if (!isComplete) {
      throw new Error(`Timed out waiting for job ${jobId} to complete after ${maxWaitTimeMs}ms`);
    }
    
    // Job completed successfully
    return new Response(
      JSON.stringify({
        success: true,
        message: `Job ${jobId} completed successfully`,
        job: {
          id: job.id,
          url: job.url,
          status: job.status,
          html_length: job.html_length,
          page_id: job.page_id,
          processing_time_ms: job.processing_time_ms
        },
        waitTime: Date.now() - startTime
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});