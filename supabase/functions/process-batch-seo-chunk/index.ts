// Process a batch of crawl jobs with the SEO workflow in smaller chunks
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 5; // Process 5 jobs at a time to avoid timeout

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get Supabase URL and service role key from environment
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    // Parse request body for parameters
    let params = {};
    try {
      params = await req.json();
    } catch (e) {
      params = {};
    }
    
    // Get batch ID and offset from URL parameters or request body
    const url = new URL(req.url);
    const batchId = url.searchParams.get('batchId') || params.batchId;
    const offset = parseInt(url.searchParams.get('offset') || params.offset || '0', 10);
    
    if (!batchId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Batch ID is required. Provide it as a query parameter (?batchId=...) or in request body'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    console.log(`Processing batch ID: ${batchId}, offset: ${offset}, chunk size: ${CHUNK_SIZE}`);
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Get total count of jobs to process
    const { count, error: countError } = await supabase
      .from('crawl_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('status', 'completed');
      
    if (countError) {
      throw new Error(`Error getting job count: ${countError.message}`);
    }
    
    console.log(`Found ${count} completed jobs for batch ${batchId}`); // Add logging
    
    // Find completed jobs in this batch, with pagination
    const { data: jobs, error: jobsError } = await supabase
      .from('crawl_jobs')
      .select('id, url, page_id, html_length')
      .eq('batch_id', batchId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .range(offset, offset + CHUNK_SIZE - 1);
    
    if (jobsError) {
      throw new Error(`Error fetching jobs for batch ${batchId}: ${jobsError.message}`);
    }
    
    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `No more completed crawl jobs found for batch ${batchId} at offset ${offset}`,
          count: 0,
          total: count,
          done: true
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    console.log(`Processing ${jobs.length} jobs from offset ${offset} (out of ${count} total)`);
    
    // Results to track success/failure
    const results = {
      total: count,
      processed: jobs.length,
      success: 0,
      failed: 0,
      current_offset: offset,
      next_offset: offset + jobs.length,
      done: offset + jobs.length >= count,
      details: [] as any[]
    };
    
    // Process each job with the SEO workflow
    for (const job of jobs) {
      console.log(`Processing job ${job.id} (URL: ${job.url})`);
      
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/seo-direct-workflow-with-tracking`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({
            jobId: job.id
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Failed to process job ${job.id}: ${response.status} ${response.statusText} - ${errorText}`);
          
          results.failed++;
          results.details.push({
            jobId: job.id,
            url: job.url,
            success: false,
            error: `${response.status} ${response.statusText}`
          });
          
          continue;
        }
        
        const result = await response.json();
        console.log(`Successfully processed job ${job.id}`);
        
        results.success++;
        results.details.push({
          jobId: job.id,
          url: job.url,
          success: true
        });
      } catch (error) {
        console.error(`Error processing job ${job.id}: ${error.message}`);
        
        results.failed++;
        results.details.push({
          jobId: job.id,
          url: job.url,
          success: false,
          error: error.message
        });
      }
      
      // Add a small delay between requests to avoid overload
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Generate the next chunk URL if there are more jobs to process
    let nextChunkUrl = null;
    if (!results.done) {
      nextChunkUrl = `${SUPABASE_URL}/functions/v1/process-batch-seo-chunk?batchId=${batchId}&offset=${results.next_offset}`;
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${jobs.length} jobs from batch ${batchId} (offset: ${offset})`,
        results,
        next_chunk: nextChunkUrl
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});