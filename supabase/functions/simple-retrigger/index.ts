// Simple approach to retrigger workflows
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
    // Get Supabase URL and service role key from environment
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    // Parse request to get batch ID (optional)
    const url = new URL(req.url);
    const batchId = url.searchParams.get('batchId');
    
    console.log(`Processing requests${batchId ? ` for batch ${batchId}` : ''}`);
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Get completed crawl jobs
    let query = supabase
      .from('crawl_jobs')
      .select('id, page_id, url, batch_id')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10);
    
    // Filter by batch ID if provided
    if (batchId) {
      query = query.eq('batch_id', batchId);
    }
    
    const { data: jobs, error: jobsError } = await query;
    
    if (jobsError) {
      throw new Error(`Error getting completed jobs: ${jobsError.message}`);
    }
    
    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No completed jobs found',
          count: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    console.log(`Found ${jobs.length} completed jobs`);
    
    // Results to track success/failure
    const results = {
      total: jobs.length,
      success: 0,
      failed: 0,
      details: []
    };
    
    // Retrigger workflows for each job
    for (const job of jobs) {
      console.log(`Retriggering workflow for job ${job.id} (URL: ${job.url})`);
      
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-workflow-after-crawl`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({
            jobId: job.id,
            skipCrawl: true
          })
        });
        
        const responseText = await response.text();
        let result;
        try {
          result = JSON.parse(responseText);
        } catch (e) {
          result = { text: responseText };
        }
        
        if (!response.ok) {
          console.error(`Failed to trigger workflow for job ${job.id}: ${response.status} ${response.statusText} - ${responseText}`);
          
          results.failed++;
          results.details.push({
            jobId: job.id,
            url: job.url,
            success: false,
            error: `${response.status} ${response.statusText}`,
            response: result
          });
        } else {
          console.log(`Successfully triggered workflow for job ${job.id}`);
          
          results.success++;
          results.details.push({
            jobId: job.id,
            url: job.url,
            success: true,
            response: result
          });
        }
      } catch (error) {
        console.error(`Error triggering workflow for job ${job.id}:`, error);
        
        results.failed++;
        results.details.push({
          jobId: job.id,
          url: job.url,
          success: false,
          error: error.message
        });
      }
      
      // Add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${jobs.length} completed jobs`,
        results
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