import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { logError } from '../utils/error-handling.ts';

const FUNCTION_NAME = 'cron-process-classifications';
const MAX_CONCURRENT_JOBS = 3; // Process up to 3 jobs at once
const MAX_BATCHES_PER_JOB = 5; // Process up to 5 batches per job

serve(async (req) => {
  // This function is intended to be called by a scheduler
  // but we'll also support manual invocation with proper authorization
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    // Verify authorization for manual invocation
    if (req.method === 'POST') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      // For manual calls, we could parse the request body for customizations
      const body = await req.json().catch(() => ({}));
      const customMaxJobs = body.maxJobs || MAX_CONCURRENT_JOBS;
      const customMaxBatches = body.maxBatches || MAX_BATCHES_PER_JOB;
      
      // But we'd still validate authorization
      const token = authHeader.replace('Bearer ', '');
      
      // Create a client
      const authClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user }, error: userError } = await authClient.auth.getUser(token);
      
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      // Check if admin
      const { data: isAdmin } = await authClient
        .rpc('check_admin_role', { user_uuid: user.id })
        .single();
        
      if (!isAdmin || !isAdmin.is_admin) {
        return new Response(
          JSON.stringify({ error: 'Forbidden: Admin access required' }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }
    
    // For cron invocation or authorized manual invocation, proceed
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find pending and processing jobs
    const { data: activeJobs, error: jobsError } = await supabase
      .from('classification_jobs')
      .select('id, status, current_batch, total_batches, created_at')
      .or('status.eq.pending,status.eq.processing')
      .order('created_at', { ascending: true })
      .limit(MAX_CONCURRENT_JOBS);
      
    if (jobsError) {
      console.error('Error fetching active jobs:', jobsError);
      await logError(FUNCTION_NAME, null, new Error(`Error fetching active jobs: ${jobsError.message}`));
      
      return new Response(
        JSON.stringify({ error: 'Error fetching active jobs' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // If no jobs to process
    if (!activeJobs || activeJobs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No jobs to process' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log(`Processing ${activeJobs.length} active jobs`);
    
    // Process each job by calling process-classification-batch
    const results = await Promise.all(activeJobs.map(async (job) => {
      const batches = [];
      
      // Process up to MAX_BATCHES_PER_JOB batches for this job
      for (let i = 0; i < MAX_BATCHES_PER_JOB; i++) {
        try {
          const processBatchEndpoint = `${supabaseUrl}/functions/v1/process-classification-batch`;
          
          const response = await fetch(processBatchEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              jobId: job.id,
              manual: false
            }),
          });
          
          const result = await response.json();
          
          // If the job is complete or there are no more batches, stop processing
          if (result.status === 'completed' || result.message === 'No more batches to process') {
            batches.push(result);
            break;
          }
          
          batches.push(result);
        } catch (error) {
          console.error(`Error processing batch for job ${job.id}:`, error);
          await logError(FUNCTION_NAME, job.id, error instanceof Error ? error : new Error(String(error)));
          
          // Continue with next job if there's an error
          break;
        }
      }
      
      return {
        jobId: job.id,
        batchesProcessed: batches.length,
        results: batches
      };
    }));
    
    return new Response(
      JSON.stringify({
        message: 'Cron process completed',
        jobsProcessed: results.length,
        timestamp: new Date().toISOString(),
        details: results
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in cron process:', error);
    await logError(FUNCTION_NAME, null, error instanceof Error ? error : new Error(String(error)));
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});