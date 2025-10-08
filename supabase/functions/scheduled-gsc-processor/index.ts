// scheduled-gsc-processor
// A scheduled function to process the GSC job queue
// This is designed to be run on a schedule (every 10 minutes)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Configuration
const MAX_JOBS_PER_RUN = 5; // Maximum number of jobs to process in one run
const MAX_RUNTIME_SECONDS = 540; // 9 minutes (to stay under 10-minute edge function limit)

serve(async (req) => {
  // Set start time to track execution duration
  const startTime = Date.now();
  
  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    console.log('GSC queue processor started');
    
    // Check for stuck jobs first - use a shorter timeout for faster recovery
    try {
      const { data: rescuedJobs } = await supabaseClient.rpc('rescue_stuck_gsc_jobs', { p_minutes_threshold: 5 });
      console.log(`Rescued ${rescuedJobs || 0} stuck jobs`);
      
      // Manually check for stuck processing jobs and reset them
      const { data: stuckJobs, error: stuckError } = await supabaseClient
        .from('gsc_job_queue')
        .select('id')
        .eq('status', 'processing')
        .lt('last_heartbeat', new Date(Date.now() - 5 * 60 * 1000).toISOString());
      
      if (stuckError) {
        console.error('Error checking for stuck jobs:', stuckError);
      } else if (stuckJobs && stuckJobs.length > 0) {
        console.log(`Found ${stuckJobs.length} manually stuck jobs to reset`);
        
        // Reset these jobs to pending status
        for (const job of stuckJobs) {
          await supabaseClient.rpc('update_gsc_job_progress', {
            p_job_id: job.id,
            p_rows_processed: 0,
            p_message: 'Job was reset after being stuck'
          });
          
          await supabaseClient
            .from('gsc_job_queue')
            .update({ 
              status: 'pending',
              error: 'Job was reset after being stuck in processing state'
            })
            .eq('id', job.id);
            
          console.log(`Reset stuck job ${job.id} to pending status`);
        }
      }
    } catch (error) {
      console.error('Error rescuing stuck jobs:', error);
    }
    
    // Get queue statistics before processing
    let queueStatsBefore;
    try {
      const { data } = await supabaseClient.rpc('get_gsc_job_stats');
      queueStatsBefore = data?.[0];
      console.log('Queue stats:', queueStatsBefore);
    } catch (error) {
      console.error('Error getting queue stats:', error);
    }
    
    // Process jobs until we hit the limit or run out of time
    let jobsProcessed = 0;
    let totalRowsProcessed = 0;
    
    while (
      jobsProcessed < MAX_JOBS_PER_RUN && 
      (Date.now() - startTime) / 1000 < MAX_RUNTIME_SECONDS
    ) {
      // Get the next job from the queue
      console.log(`Fetching job ${jobsProcessed + 1}/${MAX_JOBS_PER_RUN}...`);
      const { data: job, error: jobError } = await supabaseClient.rpc('get_next_gsc_job');
      
      if (jobError) {
        console.error('Error getting next job:', jobError);
        break;
      }
      
      // If no job is available, we're done
      if (!job || job.length === 0) {
        console.log('No more jobs in queue');
        break;
      }
      
      const currentJob = job[0];
      console.log(`Processing job ${currentJob.id} for client ${currentJob.client_id}`);
      
      try {
        // Process the job
        await processJob(supabaseClient, currentJob);
        jobsProcessed++;
        
        // Get job stats to update total rows processed
        const { data: jobData } = await supabaseClient
          .from('gsc_job_queue')
          .select('rows_processed')
          .eq('id', currentJob.id)
          .single();
          
        if (jobData) {
          totalRowsProcessed += jobData.rows_processed || 0;
        }
      } catch (error) {
        console.error(`Error processing job ${currentJob.id}:`, error);
        
        // Mark job as failed
        await supabaseClient.rpc('fail_gsc_job', {
          p_job_id: currentJob.id,
          p_error: error instanceof Error ? error.message : String(error)
        });
      }
      
      // Add a small delay between jobs
      if (jobsProcessed < MAX_JOBS_PER_RUN) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Get queue statistics after processing
    let queueStatsAfter;
    try {
      const { data } = await supabaseClient.rpc('get_gsc_job_stats');
      queueStatsAfter = data?.[0];
    } catch (error) {
      console.error('Error getting queue stats:', error);
    }
    
    // Calculate execution time
    const executionTime = (Date.now() - startTime) / 1000;
    
    // Return results
    return new Response(
      JSON.stringify({
        success: true,
        jobsProcessed,
        totalRowsProcessed,
        executionTime: `${executionTime.toFixed(2)} seconds`,
        queueStats: {
          before: queueStatsBefore,
          after: queueStatsAfter
        },
        message: jobsProcessed > 0 
          ? `Processed ${jobsProcessed} jobs with ${totalRowsProcessed} total rows` 
          : 'No jobs were processed'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scheduler error:', error);
    
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

// Process a single job
async function processJob(supabaseClient, job) {
  console.log(`Processing job ${job.id} for site ${job.site_url} (${job.start_date} to ${job.end_date})`);
  
  // Get full job details
  const { data: jobDetails } = await supabaseClient
    .from('gsc_job_queue')
    .select('*')
    .eq('id', job.id)
    .single();
    
  if (!jobDetails) {
    throw new Error(`Job ${job.id} not found`);
  }
  
  try {
    // Process the job with pagination
    let hasMoreData = true;
    let currentStartRow = 0;
    let totalRows = 0;
    let batchNumber = 1;
    
    // Process batches until we've fetched all data
    while (hasMoreData) {
      // Update progress in database
      await supabaseClient.rpc('update_gsc_job_progress', {
        p_job_id: job.id,
        p_rows_processed: totalRows,
        p_message: `Processing batch #${batchNumber} starting at row ${currentStartRow}`
      });
      
      // Call the GSC API to fetch data
      const result = await fetchGscData(supabaseClient, {
        jobId: job.id,
        siteUrl: job.site_url,
        startDate: job.start_date,
        endDate: job.end_date,
        startRow: currentStartRow,
        rowLimit: 25000 // Max rows per request
      });
      
      // Process results
      const rowsFetched = result.rowsProcessed || 0;
      totalRows += rowsFetched;
      
      // Register this batch in the database
      await supabaseClient.rpc('register_gsc_job_batch', {
        p_job_id: job.id,
        p_batch_number: batchNumber,
        p_start_row: currentStartRow,
        p_rows_fetched: rowsFetched
      });
      
      // Check if we need to fetch more data
      hasMoreData = rowsFetched === 25000; // Full page means there might be more
      
      if (hasMoreData) {
        // Move to next batch
        currentStartRow += 25000;
        batchNumber++;
      }
    }
    
    // Mark job as completed - use direct update in case the RPC fails
    try {
      await supabaseClient.rpc('complete_gsc_job', {
        p_job_id: job.id,
        p_rows_processed: totalRows
      });
    } catch (completeError) {
      console.error(`Error with complete_gsc_job RPC, trying direct update:`, completeError);
      
      // Fallback to direct update
      await supabaseClient
        .from('gsc_job_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          rows_processed: totalRows,
          last_heartbeat: new Date().toISOString()
        })
        .eq('id', job.id);
    }
    
    console.log(`Job ${job.id} completed successfully with ${totalRows} total rows`);
    return totalRows;
  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    
    // Mark job as failed
    await supabaseClient.rpc('fail_gsc_job', {
      p_job_id: job.id,
      p_error: error instanceof Error ? error.message : String(error)
    });
    
    throw error;
  }
}

// Fetch GSC data using the ingest-gsc function
async function fetchGscData(supabaseClient, params) {
  const { jobId, siteUrl, startDate, endDate, startRow, rowLimit } = params;
  
  // Get the job's filtering criteria
  const { data: job } = await supabaseClient
    .from('gsc_job_queue')
    .select('min_position, max_position, min_impressions, min_clicks, max_keywords_per_url, keywords_sort_by, specific_urls, additional_filters')
    .eq('id', jobId)
    .single();
    
  // Call the ingest-gsc function directly using fetch
  const gscApiUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ingest-gsc`;
  
  // Prepare request body with filtering criteria
  const requestBody = {
    siteUrl,
    startDate,
    endDate,
    startRow,
    rowLimit,
    filters: {
      minPosition: job.min_position,
      maxPosition: job.max_position,
      minImpressions: job.min_impressions,
      minClicks: job.min_clicks,
      maxKeywordsPerUrl: job.max_keywords_per_url,
      keywordsSortBy: job.keywords_sort_by,
      specificUrls: job.specific_urls,
      additionalFilters: job.additional_filters
    }
  };
  
  // Add retries for API calls
  const maxRetries = 3;
  let retryCount = 0;
  let lastError;
  
  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(gscApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GSC API error: ${response.status} ${errorText}`);
      }
      
      const result = await response.json();
      
      // Check if we got a successful response with row data
      if (result && typeof result.rowsProcessed !== 'undefined') {
        return result;
      } else {
        throw new Error(`Invalid API response: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      lastError = error;
      retryCount++;
      
      if (retryCount <= maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, 10000);
        console.log(`API call failed, retrying in ${delay}ms (${retryCount}/${maxRetries}):`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error(`Failed after ${maxRetries} retries:`, error);
        throw lastError;
      }
    }
  }
  
  throw lastError || new Error('Unexpected error in API call');
}