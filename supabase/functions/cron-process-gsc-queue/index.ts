// PagePerfect: cron-process-gsc-queue
// Cron job to periodically process the GSC queue
// This runs on a schedule and processes multiple jobs in sequence

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

serve(async (req) => {
  try {
    // Only allow scheduled invocations
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !isValidCronAuth(authHeader)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Process multiple jobs from the queue
    const result = await processJobBatch(supabaseClient);

    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in cron-process-gsc-queue:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});

// Process multiple jobs in a batch
async function processJobBatch(supabaseClient) {
  console.log('Starting GSC job batch processing');
  
  // Check for stuck jobs first
  const { data: rescuedJobs } = await supabaseClient.rpc('rescue_stuck_gsc_jobs', { p_minutes_threshold: 15 });
  console.log(`Rescued ${rescuedJobs || 0} stuck jobs`);
  
  // Get stats before processing
  const { data: statsBefore } = await supabaseClient.rpc('get_gsc_job_stats');
  
  // Configuration
  const MAX_JOBS_PER_BATCH = 10;
  const MAX_EXECUTION_TIME = 540; // 9 minutes (to stay under 10-minute edge function limit)
  
  const startTime = Date.now();
  let jobsProcessed = 0;
  let totalRowsProcessed = 0;
  
  // Process jobs until we hit the limits
  while (
    jobsProcessed < MAX_JOBS_PER_BATCH && 
    (Date.now() - startTime) / 1000 < MAX_EXECUTION_TIME
  ) {
    // Process one job
    const processorUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-gsc-queue`;
    
    try {
      const response = await fetch(processorUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error calling process-gsc-queue: ${response.status} ${errorText}`);
        break;
      }
      
      const result = await response.json();
      
      // If no jobs were processed, the queue is empty
      if (result.processed === 0) {
        console.log('No more jobs to process');
        break;
      }
      
      // Update counters
      jobsProcessed++;
      totalRowsProcessed += result.rowsProcessed || 0;
      
      console.log(`Processed job ${result.jobId} with ${result.rowsProcessed || 0} rows`);
    } catch (error) {
      console.error('Error processing job:', error);
      break;
    }
    
    // Add a small delay between jobs to avoid overwhelming the system
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Get stats after processing
  const { data: statsAfter } = await supabaseClient.rpc('get_gsc_job_stats');
  
  const executionTime = (Date.now() - startTime) / 1000;
  
  return {
    jobsProcessed,
    totalRowsProcessed,
    executionTime: `${executionTime.toFixed(2)} seconds`,
    queueStats: {
      before: statsBefore?.[0] || null,
      after: statsAfter?.[0] || null
    },
    message: jobsProcessed > 0 
      ? `Processed ${jobsProcessed} jobs with ${totalRowsProcessed} total rows` 
      : 'No jobs were processed'
  };
}

// Validate that this is being called by the authorized cron job
function isValidCronAuth(authHeader) {
  // In production, you should implement proper validation here
  // This could be a shared secret or JWT validation
  // For now, we'll check for the service role key as a simple verification
  const expectedKey = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  return authHeader === expectedKey;
}