// SEO Pipeline Researcher Worker
// Handles GSC data fetching and keyword research stage of the SEO pipeline

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ResearcherRequest {
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
      workerId = `researcher-${Date.now()}`,
      maxJobs = 10,
      timeoutMinutes = 8
    } = await req.json() as ResearcherRequest;

    console.log(`SEO Pipeline Researcher Worker: ${workerId} starting`);

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
        // Get next research job (either crawl_complete or pages that already have HTML)
        const { data: jobs } = await supabaseClient
          .rpc('get_next_pipeline_job', {
            target_stage: 'crawl_complete',
            worker_id: workerId,
            lock_timeout_minutes: timeoutMinutes
          });

        if (!jobs || jobs.length === 0) {
          console.log('No more research jobs available');
          break;
        }

        const job = jobs[0];
        console.log(`Processing research job ${job.job_id} for URL: ${job.page_url}`);
        
        results.jobsProcessed++;

        try {
          // Step 1: Check if we already have GSC keywords for this page
          const { data: existingKeywords } = await supabaseClient
            .from('gsc_keywords')
            .select('count(*)', { count: 'exact' })
            .eq('page_id', job.page_id);

          const keywordCount = existingKeywords?.count || 0;
          let gscDataFetched = false;
          let aiKeywordsGenerated = false;

          // Step 2: Fetch GSC data if we don't have keywords
          if (keywordCount === 0) {
            console.log(`Fetching GSC data for page ${job.page_id}`);
            
            try {
              const gscResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fetch-gsc-data`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({
                  pageId: job.page_id,
                  url: job.page_url
                })
              });

              if (gscResponse.ok) {
                const gscResult = await gscResponse.json();
                if (gscResult.success) {
                  gscDataFetched = true;
                  console.log(`GSC data fetched successfully for ${job.page_url}`);
                }
              } else {
                console.log(`GSC data fetch failed for ${job.page_url}, will try AI extraction`);
              }
            } catch (gscError) {
              console.log(`GSC error for ${job.page_url}: ${gscError}, will try AI extraction`);
            }
          } else {
            console.log(`Page ${job.page_id} already has ${keywordCount} GSC keywords`);
            gscDataFetched = true; // Consider it done
          }

          // Step 3: Check keyword count again after GSC attempt
          const { data: updatedKeywords } = await supabaseClient
            .from('gsc_keywords')
            .select('count(*)', { count: 'exact' })
            .eq('page_id', job.page_id);

          const finalKeywordCount = updatedKeywords?.count || 0;

          // Step 4: Generate AI keywords if we still have fewer than 3
          if (finalKeywordCount < 3) {
            console.log(`Generating AI keywords for page ${job.page_id} (current count: ${finalKeywordCount})`);
            
            try {
              const keywordResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-content-keywords`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({
                  pageId: job.page_id,
                  saveToDatabase: true
                })
              });

              if (keywordResponse.ok) {
                const keywordResult = await keywordResponse.json();
                if (keywordResult.success && keywordResult.gscCompatibleKeywords?.length > 0) {
                  aiKeywordsGenerated = true;
                  console.log(`AI keywords generated successfully for ${job.page_url}: ${keywordResult.gscCompatibleKeywords.length} keywords`);
                }
              }
            } catch (aiError) {
              console.error(`AI keyword generation failed for ${job.page_url}:`, aiError);
            }
          }

          // Step 5: Get final keyword count
          const { data: finalKeywords } = await supabaseClient
            .from('gsc_keywords')
            .select('count(*)', { count: 'exact' })
            .eq('page_id', job.page_id);

          const totalKeywords = finalKeywords?.count || 0;

          // Advance job to next stage
          const { data: advanceResult, error: advanceError } = await supabaseClient
            .rpc('advance_pipeline_job', {
              job_id: job.job_id,
              next_stage: 'keyword_complete',
              stage_result: {
                gsc_data_fetched: gscDataFetched,
                ai_keywords_generated: aiKeywordsGenerated,
                total_keywords: totalKeywords,
                timestamp: new Date().toISOString()
              }
            });

          if (advanceError || !advanceResult) {
            throw new Error(`Failed to advance job to next stage: ${advanceError?.message || 'Unknown error'}`);
          }

          results.jobsSucceeded++;
          console.log(`Research job ${job.job_id} completed successfully - ${totalKeywords} total keywords`);

        } catch (jobError) {
          console.error(`Error processing research job ${job.job_id}:`, jobError);
          
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
        console.error('Error in researcher worker loop:', error);
        results.errors.push(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }

    const endTime = Date.now();
    const duration = endTime - results.startTime;

    console.log(`Researcher worker ${workerId} completed: ${results.jobsSucceeded}/${results.jobsProcessed} jobs in ${duration}ms`);

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
    console.error('Error in seo-pipeline-researcher:', error);
    
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