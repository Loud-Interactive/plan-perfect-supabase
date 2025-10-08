// process-specific-job
// Process a specific job from the GSC queue by ID

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
    
    // Parse request body
    const { jobId } = await req.json();
    
    if (!jobId) {
      throw new Error('jobId is required');
    }
    
    console.log(`Processing specific job: ${jobId}`);
    
    // Get the job details
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
    
    console.log(`Found job for client ${job.client_id}, site ${job.site_url}`);
    
    // Mark job as processing
    await supabaseClient
      .from('gsc_job_queue')
      .update({
        status: 'processing',
        attempts: job.attempts + 1,
        started_at: job.started_at || new Date().toISOString(),
        last_heartbeat: new Date().toISOString()
      })
      .eq('id', jobId);
    
    // Process the job
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
          p_job_id: jobId,
          p_rows_processed: totalRows,
          p_message: `Processing batch #${batchNumber} starting at row ${currentStartRow}`
        });
        
        console.log(`Fetching batch #${batchNumber} starting at row ${currentStartRow}`);
        
        // Call the GSC API to fetch data
        const result = await fetchGscData(job.site_url, job.start_date, job.end_date, currentStartRow, 25000, {
          minPosition: job.min_position,
          maxPosition: job.max_position,
          minImpressions: job.min_impressions,
          minClicks: job.min_clicks,
          maxKeywordsPerUrl: job.max_keywords_per_url,
          keywordsSortBy: job.keywords_sort_by,
          specificUrls: job.specific_urls
        });
        
        // Process results
        const rowsFetched = result.rowsProcessed || 0;
        totalRows += rowsFetched;
        
        console.log(`Batch #${batchNumber} fetched ${rowsFetched} rows`);
        
        // Check if we need to fetch more data
        hasMoreData = rowsFetched === 25000; // Full page means there might be more
        
        if (hasMoreData) {
          // Move to next batch
          currentStartRow += 25000;
          batchNumber++;
        }
      }
      
      // Mark job as completed
      await supabaseClient
        .from('gsc_job_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          rows_processed: totalRows,
          last_heartbeat: new Date().toISOString()
        })
        .eq('id', jobId);
      
      console.log(`Job ${jobId} completed successfully with ${totalRows} total rows`);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: `Job ${jobId} processed successfully`,
          rowsProcessed: totalRows
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`Error processing job ${jobId}:`, error);
      
      // Mark job as failed
      await supabaseClient
        .from('gsc_job_queue')
        .update({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          last_heartbeat: new Date().toISOString()
        })
        .eq('id', jobId);
      
      throw error;
    }
  } catch (error) {
    console.error('Error:', error);
    
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

// Fetch GSC data using the ingest-gsc function
async function fetchGscData(siteUrl, startDate, endDate, startRow, rowLimit, filters) {
  const gscApiUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ingest-gsc`;
  
  const requestBody = {
    siteUrl,
    startDate,
    endDate,
    startRow,
    rowLimit,
    filters
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