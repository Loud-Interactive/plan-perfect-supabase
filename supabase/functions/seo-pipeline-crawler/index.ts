// SEO Pipeline Crawler Worker
// Handles HTML content fetching stage of the SEO pipeline

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CrawlerRequest {
  workerId?: string;
  maxJobs?: number;
  timeoutMinutes?: number;
}

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
    const {
      workerId = `crawler-${Date.now()}`,
      maxJobs = 10,
      timeoutMinutes = 5
    } = await req.json() as CrawlerRequest;

    console.log(`SEO Pipeline Crawler Worker: ${workerId} starting`);

    const results = {
      workerId,
      jobsProcessed: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      startTime: Date.now(),
      errors: [] as string[]
    };

    // Process jobs until we hit the limit or run out of work
    for (let i = 0; i < maxJobs; i++) {
      try {
        // Get next crawling job
        const { data: jobs } = await supabaseClient
          .rpc('get_next_pipeline_job', {
            target_stage: 'queued',
            worker_id: workerId,
            lock_timeout_minutes: timeoutMinutes
          });

        if (!jobs || jobs.length === 0) {
          console.log('No more crawling jobs available');
          break;
        }

        const job = jobs[0];
        console.log(`Processing crawl job ${job.job_id} for URL: ${job.page_url}`);
        
        results.jobsProcessed++;

        try {
          // Check if page already has HTML content
          const { data: pageData } = await supabaseClient
            .from('pages')
            .select('html, html_length')
            .eq('id', job.page_id)
            .single();

          let needsCrawling = true;
          
          if (pageData?.html && pageData.html.length > 100) {
            console.log(`Page ${job.page_id} already has HTML content (${pageData.html_length} chars), skipping crawl`);
            needsCrawling = false;
          }

          if (needsCrawling) {
            // Call crawl-page-html function
            const crawlResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/crawl-page-html`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({
                url: job.page_url,
                pageId: job.page_id
              })
            });

            if (!crawlResponse.ok) {
              const errorText = await crawlResponse.text();
              throw new Error(`Crawl failed: ${crawlResponse.status} - ${errorText}`);
            }

            const crawlResult = await crawlResponse.json();
            
            if (!crawlResult.success) {
              throw new Error(`Crawl failed: ${crawlResult.error || 'Unknown error'}`);
            }

            console.log(`Successfully crawled ${job.page_url} - ${crawlResult.htmlLength} chars`);
          }

          // Advance job to next stage
          const { data: advanceResult, error: advanceError } = await supabaseClient
            .rpc('advance_pipeline_job', {
              job_id: job.job_id,
              next_stage: 'crawl_complete',
              stage_result: {
                crawled: needsCrawling,
                html_length: pageData?.html_length || 0,
                timestamp: new Date().toISOString()
              }
            });

          if (advanceError || !advanceResult) {
            throw new Error(`Failed to advance job to next stage: ${advanceError?.message || 'Unknown error'}`);
          }

          results.jobsSucceeded++;
          console.log(`Crawl job ${job.job_id} completed successfully`);

        } catch (jobError) {
          console.error(`Error processing crawl job ${job.job_id}:`, jobError);
          
          // Mark job as failed
          await supabaseClient
            .rpc('fail_pipeline_job', {
              job_id: job.job_id,
              error_message: jobError instanceof Error ? jobError.message : String(jobError),
              retry_job: true
            });

          results.jobsFailed++;
          results.errors.push(`Job ${job.job_id}: ${jobError instanceof Error ? jobError.message : String(jobError)}`);
        }

      } catch (error) {
        console.error('Error in crawler worker loop:', error);
        results.errors.push(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }

    const endTime = Date.now();
    const duration = endTime - results.startTime;

    console.log(`Crawler worker ${workerId} completed: ${results.jobsSucceeded}/${results.jobsProcessed} jobs in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        endTime,
        duration,
        avgTimePerJob: results.jobsProcessed > 0 ? duration / results.jobsProcessed : 0
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (error) {
    console.error('Error in seo-pipeline-crawler:', error);
    
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