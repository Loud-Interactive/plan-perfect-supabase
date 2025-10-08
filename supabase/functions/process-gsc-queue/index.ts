// PagePerfect: process-gsc-queue
// Worker function to process jobs from the GSC queue

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

    // Process a single job from the queue
    const result = await processNextJob(supabaseClient);

    // Return job processing result
    return new Response(
      JSON.stringify({
        success: true,
        ...result
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error in process-gsc-queue:', error);
    
    // Return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Process the next job in the queue
async function processNextJob(supabaseClient) {
  console.log('Looking for the next job to process...');

  // Get the next job from the queue
  const { data: job, error: jobError } = await supabaseClient.rpc('get_next_gsc_job');

  if (jobError) {
    console.error('Error getting next job:', jobError);
    throw new Error(`Failed to get next job: ${jobError.message}`);
  }

  // If no job is available, return
  if (!job || job.length === 0) {
    console.log('No jobs available in the queue');
    return { processed: 0, message: 'No jobs available in the queue' };
  }

  const currentJob = job[0];
  console.log(`Processing job ${currentJob.id} for client ${currentJob.client_id}, site ${currentJob.site_url}`);
  
  // Get full job details including filtering criteria
  const { data: jobDetails } = await supabaseClient
    .from('gsc_job_queue')
    .select('*')
    .eq('id', currentJob.id)
    .single();
    
  // Combine with currentJob
  const fullJob = { ...currentJob, ...jobDetails };

  try {
    // Process the job with pagination
    let hasMoreData = true;
    let currentStartRow = 0;
    let totalRows = 0;
    let batchNumber = 1;

    // Process batches until we've fetched all data
    while (hasMoreData) {
      console.log(`Fetching batch #${batchNumber} starting at row ${currentStartRow}`);
      
      // Update progress in database
      await supabaseClient.rpc('update_gsc_job_progress', {
        p_job_id: currentJob.id,
        p_rows_processed: totalRows,
        p_message: `Processing batch #${batchNumber} starting at row ${currentStartRow}`
      });

      // Call the GSC API to fetch data
      const result = await fetchGscData(supabaseClient, {
        jobId: currentJob.id,
        siteUrl: currentJob.site_url,
        startDate: currentJob.start_date,
        endDate: currentJob.end_date,
        startRow: currentStartRow,
        rowLimit: 25000 // Max rows per request
      });

      // Process results
      const rowsFetched = result.rowsProcessed || 0;
      totalRows += rowsFetched;
      
      // Register this batch in the database
      await supabaseClient.rpc('register_gsc_job_batch', {
        p_job_id: currentJob.id,
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

    // Mark job as completed
    await supabaseClient.rpc('complete_gsc_job', {
      p_job_id: currentJob.id,
      p_rows_processed: totalRows
    });

    console.log(`Job ${currentJob.id} completed successfully with ${totalRows} total rows`);
    return { 
      processed: 1, 
      jobId: currentJob.id, 
      siteUrl: currentJob.site_url,
      rowsProcessed: totalRows,
      batches: batchNumber
    };
  } catch (error) {
    console.error(`Error processing job ${currentJob.id}:`, error);
    
    // Mark job as failed
    await supabaseClient.rpc('fail_gsc_job', {
      p_job_id: currentJob.id,
      p_error: error instanceof Error ? error.message : String(error)
    });
    
    return { 
      processed: 0, 
      jobId: currentJob.id,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Fetch GSC data using the ingest-gsc function
async function fetchGscData(supabaseClient, params) {
  const { siteUrl, startDate, endDate, startRow, rowLimit } = params;
  
  // Get the job's filtering criteria
  const { data: job } = await supabaseClient
    .from('gsc_job_queue')
    .select('min_position, max_position, min_impressions, min_clicks, max_keywords_per_url, keywords_sort_by, specific_urls, additional_filters')
    .eq('id', params.jobId)
    .single();
    
  // Log filtering criteria
  let filterMsg = `Fetching GSC data for ${siteUrl} from ${startDate} to ${endDate}, starting at row ${startRow}`;
  if (job.max_position !== null) filterMsg += `, max position: ${job.max_position}`;
  if (job.min_position !== null) filterMsg += `, min position: ${job.min_position}`;
  if (job.min_impressions !== null) filterMsg += `, min impressions: ${job.min_impressions}`;
  if (job.min_clicks !== null) filterMsg += `, min clicks: ${job.min_clicks}`;
  if (job.max_keywords_per_url !== null) filterMsg += `, max keywords per URL: ${job.max_keywords_per_url} (sorted by ${job.keywords_sort_by || 'impressions'})`;
  
  // Log specific URLs if provided
  if (job.specific_urls && Array.isArray(job.specific_urls) && job.specific_urls.length > 0) {
    const urlCount = job.specific_urls.length;
    filterMsg += `, filtering to ${urlCount} specific URLs`;
  }
  
  console.log(filterMsg);
  
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
  
  return await response.json();
}