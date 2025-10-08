// PagePerfect: get-crawl-job
// Function to get status and details of a crawl job
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get jobId from URL parameters
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');
    
    if (!jobId) {
      throw new Error('jobId is required as a query parameter');
    }
    
    console.log(`Getting details for crawl job: ${jobId}`);
    
    // Fetch job details
    const { data: job, error } = await supabaseClient
      .from('crawl_jobs')
      .select('*, pages:page_id(*)')
      .eq('id', jobId)
      .single();
      
    if (error) {
      throw new Error(`Failed to fetch job details: ${error.message}`);
    }
    
    if (!job) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Job not found with ID: ${jobId}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      );
    }
    
    // Prepare response data
    const responseData = {
      id: job.id,
      url: job.url,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
      heartbeat_at: job.heartbeat_at,
      error: job.error,
      html_length: job.html_length,
      page_id: job.page_id,
      page: job.pages,
      success_method: job.success_method,
      processing_time_ms: job.processing_time_ms,
      retry_count: job.retry_count,
      // Only include HTML if explicitly requested (it can be very large)
      html: req.url.includes('includeHtml=true') ? job.html : undefined
    };
    
    return new Response(
      JSON.stringify({
        success: true,
        job: responseData,
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