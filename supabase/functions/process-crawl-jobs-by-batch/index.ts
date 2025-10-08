// PagePerfect: process-crawl-jobs-by-batch
// Function to process all pending crawl jobs for a specific batch_id
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  batchId: string;
  concurrency?: number; // Number of jobs to process in parallel
  maxJobs?: number; // Maximum number of jobs to process in this invocation
}

// Get ScraperAPI key from environment 
const SCRAPER_API_KEY = Deno.env.get('SCRAPER_API_KEY') || '';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (!SCRAPER_API_KEY) {
      throw new Error('SCRAPER_API_KEY is not set in environment variables');
    }

    // Parse request body
    const { batchId, concurrency = 3, maxJobs = 50 } = await req.json() as RequestBody;

    if (!batchId) {
      throw new Error('batchId is required');
    }

    console.log(`Processing crawl jobs for batch_id: ${batchId}, concurrency: ${concurrency}, maxJobs: ${maxJobs}`);

    // Find pending jobs for this batch
    const { data: jobs, error } = await supabaseClient
      .from('crawl_jobs')
      .select('*')
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(maxJobs);
    
    if (error) {
      throw new Error(`Failed to fetch crawl jobs: ${error.message}`);
    }
    
    if (!jobs || jobs.length === 0) {
      // Check if there are any jobs for this batch at all
      const { data: allJobs, error: allJobsError } = await supabaseClient
        .from('crawl_jobs')
        .select('status')
        .eq('batch_id', batchId);
      
      if (allJobsError) {
        throw new Error(`Failed to check batch existence: ${allJobsError.message}`);
      }

      if (!allJobs || allJobs.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `No crawl jobs found for batch_id: ${batchId}`,
            processed: 0
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 404
          }
        );
      }

      // Jobs exist but none are pending
      const statusCounts = allJobs.reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending crawl jobs found for this batch',
          processed: 0,
          batchId,
          statusCounts
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log(`Found ${jobs.length} pending jobs to process for batch ${batchId}`);
    
    // Process jobs in parallel with concurrency control
    const results = [];
    const errors = [];
    
    // Function to process a single job
    const processJob = async (job: any) => {
      try {
        console.log(`Processing job ${job.id} for URL: ${job.url}`);
        
        // Update job status to processing
        await supabaseClient
          .from('crawl_jobs')
          .update({
            status: 'processing',
            heartbeat_at: new Date().toISOString()
          })
          .eq('id', job.id);
        
        // Start timing
        const startTime = Date.now();
        
        // Check if this is a protected site
        const protectedSites = ['orientaltrading.com', 'wayfair.com', 'homedepot.com', 'walmart.com', 'target.com'];
        const domain = extractDomain(job.url);
        const isProtectedSite = protectedSites.some(site => domain.includes(site));
        
        let html = '';
        let successMethod = '';
        
        if (isProtectedSite) {
          // Use the protected site scraper
          try {
            console.log(`Using protected-site-scraper for ${job.url}`);
            const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/protected-site-scraper`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({
                url: job.url,
                scraperApiKey: SCRAPER_API_KEY
              })
            });
            
            if (!response.ok) {
              throw new Error(`Protected site scraper failed with status ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
              throw new Error(data.error || 'Unknown error');
            }
            
            html = data.html;
            successMethod = data.successMethod || 'protected-site-scraper';
          } catch (error) {
            // Log the error but fall back to regular scraper
            console.error(`Protected site scraper failed: ${error.message}`);
            throw error; // Rethrow to be caught by the outer catch
          }
        } else {
          // Use the regular scraper
          console.log(`Using scraper-api-fetch for ${job.url}`);
          
          const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/scraper-api-fetch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              url: job.url,
              premium: job.premium,
              ultraPremium: job.ultra_premium,
              render: job.render,
              scraperApiKey: SCRAPER_API_KEY
            })
          });
          
          if (!response.ok) {
            throw new Error(`Scraper API fetch failed with status ${response.status}`);
          }
          
          const data = await response.json();
          
          if (!data.success) {
            throw new Error(data.error || 'Unknown error');
          }
          
          html = data.html;
          successMethod = 'scraper-api-fetch';
        }
        
        // Calculate processing time
        const processingTime = Date.now() - startTime;
        
        // Update job as completed
        await supabaseClient
          .from('crawl_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            heartbeat_at: new Date().toISOString(),
            html,
            html_length: html.length,
            success_method: successMethod,
            processing_time_ms: processingTime
          })
          .eq('id', job.id);
          
        // Update page record with HTML content
        await supabaseClient
          .from('pages')
          .update({
            last_crawled: new Date().toISOString(),
            html: html,
            html_length: html.length
          })
          .eq('id', job.page_id);
        
        console.log(`Successfully completed job ${job.id} in ${processingTime}ms`);
        
        let workflowTriggered = false;
        
        // Check if auto_workflow is enabled and trigger PagePerfect workflow if so
        if (job.auto_workflow) {
          console.log(`Auto-triggering PagePerfect workflow for job ${job.id}`);
          try {
            // Call the trigger-workflow-after-crawl function
            const workflowResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/trigger-workflow-after-crawl`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({
                jobId: job.id,
                skipCrawl: true
              })
            });
            
            if (!workflowResponse.ok) {
              console.error(`Failed to trigger workflow for job ${job.id}: ${workflowResponse.status} ${workflowResponse.statusText}`);
            } else {
              const workflowResult = await workflowResponse.json();
              console.log(`Successfully triggered workflow for job ${job.id}`);
              workflowTriggered = true;
            }
          } catch (workflowError) {
            console.error(`Error triggering workflow for job ${job.id}: ${workflowError.message}`);
          }
        }

        return {
          jobId: job.id,
          url: job.url,
          status: 'completed',
          htmlLength: html.length,
          processingTime,
          successMethod,
          workflowTriggered,
          autoWorkflowEnabled: !!job.auto_workflow
        };
      } catch (error) {
        console.error(`Error processing job ${job.id}: ${error.message}`);
        
        // Update job as failed
        await supabaseClient
          .from('crawl_jobs')
          .update({
            status: 'error',
            error: error.message,
            retry_count: job.retry_count + 1,
            heartbeat_at: new Date().toISOString()
          })
          .eq('id', job.id);
        
        return {
          jobId: job.id,
          url: job.url,
          status: 'error',
          error: error.message
        };
      }
    };

    // Process jobs in batches based on concurrency
    for (let i = 0; i < jobs.length; i += concurrency) {
      const batch = jobs.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(processJob));
      
      for (const result of batchResults) {
        if (result.status === 'error') {
          errors.push(result);
        } else {
          results.push(result);
        }
      }
    }
    
    // Get final status counts for the batch
    const { data: finalStats, error: statsError } = await supabaseClient
      .rpc('count_jobs_by_batch', { batch_id: batchId });
    
    if (statsError) {
      console.error(`Failed to get batch stats: ${statsError.message}`);
    }
    
    // Return results
    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length + errors.length} crawl jobs for batch ${batchId}`,
        batchId,
        processed: results.length + errors.length,
        successful: results.length,
        failed: errors.length,
        batchStats: finalStats || null,
        results,
        errors
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

// Helper function to extract domain from URL
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch (e) {
    return url.toLowerCase(); // Fallback if URL parsing fails
  }
}