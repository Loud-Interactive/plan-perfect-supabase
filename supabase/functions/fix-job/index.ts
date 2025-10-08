// Fix and retrigger a specific job
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
    
    // Get job ID from URL or request body
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');
    
    let requestBody = {};
    if (!jobId) {
      try {
        requestBody = await req.json();
      } catch (e) {
        requestBody = {};
      }
    }
    
    const jobIdToProcess = jobId || requestBody.jobId;
    
    if (!jobIdToProcess) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Job ID is required. Provide it as a query parameter (?jobId=...) or in request body {"jobId": "..."}'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    console.log(`Processing job ID: ${jobIdToProcess}`);
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Get the job
    const { data: job, error: jobError } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('id', jobIdToProcess)
      .single();
    
    if (jobError) {
      throw new Error(`Error getting job ${jobIdToProcess}: ${jobError.message}`);
    }
    
    if (!job) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Job ${jobIdToProcess} not found`
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      );
    }
    
    console.log(`Found job ${jobIdToProcess} with status ${job.status}, URL: ${job.url}, page_id: ${job.page_id}`);
    
    // Step 1: Update page with HTML from job
    console.log(`Updating page ${job.page_id} with HTML from job ${jobIdToProcess}`);
    
    if (job.html && job.html_length > 0 && job.page_id) {
      const { error: updateError } = await supabase
        .from('pages')
        .update({
          html: job.html,
          html_length: job.html_length,
          last_crawled: job.completed_at || job.updated_at || new Date().toISOString()
        })
        .eq('id', job.page_id);
      
      if (updateError) {
        console.error(`Error updating page ${job.page_id} with HTML: ${updateError.message}`);
      } else {
        console.log(`Successfully updated page ${job.page_id} with HTML from job ${jobIdToProcess}`);
      }
    } else {
      console.warn(`Job ${jobIdToProcess} has no HTML content or page_id`);
    }
    
    // Step 2: Trigger the workflow
    console.log(`Triggering workflow for job ${jobIdToProcess}`);
    
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-workflow-after-crawl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          jobId: jobIdToProcess,
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
        return new Response(
          JSON.stringify({
            success: false,
            message: `Failed to trigger workflow for job ${jobIdToProcess}`,
            error: `${response.status} ${response.statusText}`,
            response: result
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
          }
        );
      }
      
      console.log(`Successfully triggered workflow for job ${jobIdToProcess}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully processed job ${jobIdToProcess}`,
          job: {
            id: job.id,
            url: job.url,
            status: job.status,
            page_id: job.page_id
          },
          workflow: result
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error(`Error triggering workflow for job ${jobIdToProcess}:`, error);
      
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