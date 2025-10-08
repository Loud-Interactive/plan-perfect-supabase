// PagePerfect: get-gsc-job-status
// Function to check the status of GSC jobs

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get parameters from the URL
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');
    const clientId = url.searchParams.get('clientId');
    const status = url.searchParams.get('status');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    let response;
    
    if (jobId) {
      // Get specific job details
      response = await getJobDetails(supabaseClient, jobId);
    } else {
      // Get list of jobs with optional filters
      response = await getJobsList(supabaseClient, { clientId, status, limit });
    }

    // Return job status info
    return new Response(
      JSON.stringify({
        success: true,
        ...response
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error in get-gsc-job-status:', error);
    
    // Return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Get detailed information about a single job
async function getJobDetails(supabaseClient, jobId) {
  // Get the job
  const { data: job, error: jobError } = await supabaseClient
    .from('gsc_job_queue')
    .select('*')
    .eq('id', jobId)
    .single();
    
  if (jobError) {
    throw new Error(`Failed to get job: ${jobError.message}`);
  }
  
  if (!job) {
    throw new Error(`Job with ID ${jobId} not found`);
  }
  
  // Get logs for this job
  const { data: logs, error: logsError } = await supabaseClient
    .from('gsc_job_logs')
    .select('*')
    .eq('job_id', jobId)
    .order('timestamp', { ascending: false })
    .limit(50);
    
  if (logsError) {
    console.error('Error fetching job logs:', logsError);
  }
  
  // Get batches for this job
  const { data: batches, error: batchesError } = await supabaseClient
    .from('gsc_job_batches')
    .select('*')
    .eq('job_id', jobId)
    .order('batch_number', { ascending: true });
    
  if (batchesError) {
    console.error('Error fetching job batches:', batchesError);
  }
  
  return {
    job,
    logs: logs || [],
    batches: batches || []
  };
}

// Get a list of jobs with optional filtering
async function getJobsList(supabaseClient, { clientId, status, limit }) {
  let query = supabaseClient
    .from('gsc_job_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
    
  // Apply filters if provided
  if (clientId) {
    query = query.eq('client_id', clientId);
  }
  
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data: jobs, error } = await query;
  
  if (error) {
    throw new Error(`Failed to get jobs: ${error.message}`);
  }
  
  // Get queue stats
  const { data: stats, error: statsError } = await supabaseClient.rpc(
    'get_gsc_job_stats',
    { p_client_id: clientId || null }
  );
  
  if (statsError) {
    console.error('Error fetching job stats:', statsError);
  }
  
  return {
    jobs: jobs || [],
    stats: stats?.[0] || null,
    filters: {
      clientId,
      status,
      limit
    }
  };
}