// FORCE retrigger workflow for ANY completed crawl jobs - DIRECT APPROACH
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
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Get completed crawl jobs
    const { data: jobs, error: jobsError } = await supabase
      .from('crawl_jobs')
      .select('id, page_id, url, batch_id, html, html_length')
      .eq('status', 'completed')
      .gt('html_length', 0)
      .order('completed_at', { ascending: false })
      .limit(20);
    
    if (jobsError) {
      throw new Error(`Error getting completed jobs: ${jobsError.message}`);
    }
    
    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No completed jobs with HTML found',
          count: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    console.log(`Found ${jobs.length} completed jobs with HTML`);
    
    // Copy HTML from each job to its page
    for (const job of jobs) {
      if (job.html && job.html_length > 0 && job.page_id) {
        // Update page with HTML
        const { error: updateError } = await supabase
          .from('pages')
          .update({
            html: job.html,
            html_length: job.html_length,
            last_crawled: new Date().toISOString()
          })
          .eq('id', job.page_id);
        
        if (updateError) {
          console.error(`Error updating page ${job.page_id} with HTML: ${updateError.message}`);
        } else {
          console.log(`Updated page ${job.page_id} with HTML content from job ${job.id}`);
        }
      }
    }
    
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
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Failed to trigger workflow for job ${job.id}: ${response.status} ${response.statusText} - ${errorText}`);
          
          results.failed++;
          results.details.push({
            jobId: job.id,
            url: job.url,
            success: false,
            error: `${response.status} ${response.statusText} - ${errorText}`
          });
          
          continue;
        }
        
        const result = await response.json();
        console.log(`Successfully triggered workflow for job ${job.id} (Page ID: ${result.pageId})`);
        
        results.success++;
        results.details.push({
          jobId: job.id,
          url: job.url,
          pageId: result.pageId,
          success: true
        });
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
      
      // Add a small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('Force retrigger complete');
    
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