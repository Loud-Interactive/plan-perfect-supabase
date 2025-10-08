// PagePerfect: trigger-workflow-after-crawl
// Function to trigger the pageperfect workflow after a crawl job is complete
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface RequestBody {
  jobId: string;
  skipCrawl?: boolean;
  openaiApiKey?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get Supabase URL and service role key from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    }
    
    // Create Supabase client
    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    
    // Parse request body
    const { jobId, skipCrawl = true, openaiApiKey } = await req.json() as RequestBody;
    
    if (!jobId) {
      throw new Error('jobId is required');
    }
    
    console.log(`Triggering workflow after crawl job ${jobId}`);
    
    // Get the job details
    const response = await fetch(`${supabaseUrl}/functions/v1/get-crawl-job?jobId=${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(`Error getting job status: ${result.error}`);
    }
    
    const job = result.job;
    
    // Check if job is completed
    if (job.status !== 'completed') {
      throw new Error(`Job ${jobId} is not completed. Current status: ${job.status}`);
    }
    
    // Get the page ID from the job
    const pageId = job.page_id;
    if (!pageId) {
      throw new Error(`Job ${jobId} doesn't have a page_id associated with it`);
    }
    
    // Update the page with the HTML content if not already updated
    const { data: page, error: pageError } = await supabaseClient
      .from('pages')
      .select('html, html_length, last_crawled')
      .eq('id', pageId)
      .single();
      
    if (pageError) {
      throw new Error(`Error getting page: ${pageError.message}`);
    }
    
    // If the page doesn't have HTML content or last_crawled is older than the job's updated_at
    if (!page.html || !page.html_length || !page.last_crawled || 
        new Date(page.last_crawled) < new Date(job.updated_at)) {
      
      console.log(`Updating page ${pageId} with HTML content from job ${jobId}`);
      
      // Update the page with HTML from the job
      const { error: updateError } = await supabaseClient
        .from('pages')
        .update({
          html: job.html,
          html_length: job.html_length,
          last_crawled: job.completed_at || job.updated_at
        })
        .eq('id', pageId);
        
      if (updateError) {
        throw new Error(`Error updating page with HTML: ${updateError.message}`);
      }
    }
    
    // Trigger the full PagePerfect workflow
    console.log(`Triggering PagePerfect workflow for page ${pageId}`);
    
    // Set up the steps to skip if skipCrawl is true
    const skipSteps = skipCrawl ? ['crawl', 'waitForCrawl'] : [];
    
    const workflowResponse = await fetch(`${supabaseUrl}/functions/v1/pageperfect-workflow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        pageId,
        skipSteps,
        openaiApiKey,
        forceUpdate: true
      })
    });
    
    if (!workflowResponse.ok) {
      let errorText;
      try {
        const errorBody = await workflowResponse.json();
        errorText = JSON.stringify(errorBody);
      } catch (e) {
        errorText = await workflowResponse.text();
      }
      throw new Error(`Failed to trigger workflow: ${workflowResponse.status} ${workflowResponse.statusText} - ${errorText}`);
    }
    
    const workflowResult = await workflowResponse.json();
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully triggered workflow for job ${jobId}`,
        jobId,
        pageId,
        workflow: workflowResult
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
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});