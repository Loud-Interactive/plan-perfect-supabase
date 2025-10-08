// Batch retrigger workflows for completed crawl jobs
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
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // First make sure HTML is copied from crawl_jobs to pages
    await supabase.rpc('exec_sql', {
      query: `
        UPDATE pages p
        SET 
          html = cj.html,
          html_length = LENGTH(cj.html),
          last_crawled = cj.completed_at
        FROM crawl_jobs cj
        WHERE 
          cj.page_id = p.id
          AND cj.status = 'completed'
          AND cj.html IS NOT NULL
          AND cj.html != ''
          AND (p.html IS NULL OR p.html = '' OR p.html_length = 0)
      `
    });
    
    console.log('Updated pages with HTML from crawl jobs');
    
    // Get completed jobs that need retriggering
    const { data: jobs } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          j.id as job_id, 
          j.page_id, 
          j.url,
          j.batch_id
        FROM 
          crawl_jobs j
        JOIN 
          pages p ON j.page_id = p.id
        WHERE 
          j.status = 'completed'
          -- Completed in the last 24 hours, with no restrictions on HTML content
          AND j.completed_at > NOW() - INTERVAL '24 hours'
        ORDER BY 
          j.completed_at DESC
        LIMIT 20
      `
    });
    
    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No jobs found to retrigger',
          count: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log(`Found ${jobs.length} jobs to retrigger`);
    
    // Results to track success/failure
    const results = {
      total: jobs.length,
      success: 0,
      failed: 0,
      details: []
    };
    
    // Retrigger workflows for each job
    for (const job of jobs) {
      console.log(`Retriggering workflow for job ${job.job_id} (URL: ${job.url})`);
      
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/trigger-workflow-after-crawl`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({
            jobId: job.job_id,
            skipCrawl: true
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Failed to trigger workflow for job ${job.job_id}: ${response.status} ${response.statusText} - ${errorText}`);
          
          results.failed++;
          results.details.push({
            jobId: job.job_id,
            url: job.url,
            success: false,
            error: `${response.status} ${response.statusText} - ${errorText}`
          });
          
          continue;
        }
        
        const result = await response.json();
        console.log(`Successfully triggered workflow for job ${job.job_id} (Page ID: ${result.pageId})`);
        
        results.success++;
        results.details.push({
          jobId: job.job_id,
          url: job.url,
          pageId: result.pageId,
          success: true
        });
      } catch (error) {
        console.error(`Error triggering workflow for job ${job.job_id}:`, error);
        
        results.failed++;
        results.details.push({
          jobId: job.job_id,
          url: job.url,
          success: false,
          error: error.message
        });
      }
      
      // Add a small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('Batch retrigger complete');
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Completed batch retrigger of ${jobs.length} jobs`,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 500,
      }
    );
  }
});