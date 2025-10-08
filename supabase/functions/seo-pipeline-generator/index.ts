// SEO Pipeline Generator Worker
// Handles SEO content generation stage of the SEO pipeline

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GeneratorRequest {
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
      workerId = `generator-${Date.now()}`,
      maxJobs = 5,
      timeoutMinutes = 10
    } = await req.json() as GeneratorRequest;

    console.log(`SEO Pipeline Generator Worker: ${workerId} starting`);

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
        // Get next generation job
        const { data: jobs } = await supabaseClient
          .rpc('get_next_pipeline_job', {
            target_stage: 'keyword_complete',
            worker_id: workerId,
            lock_timeout_minutes: timeoutMinutes
          });

        if (!jobs || jobs.length === 0) {
          console.log('No more generation jobs available');
          break;
        }

        const job = jobs[0];
        console.log(`Processing generation job ${job.job_id} for URL: ${job.page_url}`);
        
        results.jobsProcessed++;

        try {
          // Check if SEO recommendations already exist (h1 AND primary_keyword required)
          const { data: existingSeo } = await supabaseClient
            .from('page_seo_recommendations')
            .select('id, title, h1, meta_description, primary_keyword')
            .eq('page_id', job.page_id)
            .single();

          let seoGenerated = false;
          let seoAnalysisPerformed = false;

          // Check if we have COMPLETE SEO (non-null, non-empty h1 and primary_keyword)
          const hasValidH1 = existingSeo?.h1 && existingSeo.h1.trim().length > 0;
          const hasValidKeyword = existingSeo?.primary_keyword && existingSeo.primary_keyword.trim().length > 0;
          
          if (hasValidH1 && hasValidKeyword) {
            console.log(`Page ${job.page_id} already has complete SEO recommendations (h1: "${existingSeo.h1.substring(0, 50)}" + keyword: "${existingSeo.primary_keyword}")`);
            seoGenerated = true;
          } else {
            // Step 1: Run SEO analysis first
            console.log(`Running SEO analysis for page ${job.page_id}`);
            
            try {
              const analysisResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-page-seo`, {
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

              if (analysisResponse.ok) {
                const analysisResult = await analysisResponse.json();
                if (analysisResult.success) {
                  seoAnalysisPerformed = true;
                  console.log(`SEO analysis completed for ${job.page_url}`);
                }
              }
            } catch (analysisError) {
              console.log(`SEO analysis failed for ${job.page_url}, continuing with generation`);
            }

            // Step 2: Generate SEO elements using DeepSeek
            console.log(`Generating SEO elements for page ${job.page_id}`);
            
            try {
              const elementsResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-seo-elements-ds`, {
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

              if (elementsResponse.ok) {
                const elementsResult = await elementsResponse.json();
                if (elementsResult.success && elementsResult.seoElements) {
                  seoGenerated = true;
                  console.log(`SEO elements generated successfully for ${job.page_url}`);
                } else {
                  console.error(`SEO generation failed for ${job.page_url}: ${elementsResult.error || 'Unknown error'}`);
                }
              } else {
                const errorText = await elementsResponse.text();
                console.error(`SEO generation API failed for ${job.page_url}: ${elementsResponse.status} - ${errorText}`);
              }
            } catch (generationError) {
              console.error(`SEO generation exception for ${job.page_url}:`, generationError);
            }

            // Step 3: Retry AI generation if it failed (up to 2 more attempts)
            if (!seoGenerated) {
              console.log(`Retrying AI SEO generation for ${job.page_url} (retry 1)`);
              
              try {
                const retryResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-seo-elements-ds`, {
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

                if (retryResponse.ok) {
                  const retryResult = await retryResponse.json();
                  if (retryResult.success && retryResult.seoElements) {
                    seoGenerated = true;
                    console.log(`AI retry 1 successful for ${job.page_url}`);
                  }
                }
              } catch (retryError) {
                console.error(`AI retry 1 failed for ${job.page_url}:`, retryError);
              }
            }

            // Step 4: Second retry if still failed
            if (!seoGenerated) {
              console.log(`Retrying AI SEO generation for ${job.page_url} (retry 2)`);
              
              try {
                const retry2Response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-seo-elements-ds`, {
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

                if (retry2Response.ok) {
                  const retry2Result = await retry2Response.json();
                  if (retry2Result.success && retry2Result.seoElements) {
                    seoGenerated = true;
                    console.log(`AI retry 2 successful for ${job.page_url}`);
                  }
                }
              } catch (retry2Error) {
                console.error(`AI retry 2 failed for ${job.page_url}:`, retry2Error);
              }
            }

            // Step 5: Final retry with different model if still failed
            if (!seoGenerated) {
              console.log(`Final AI retry for ${job.page_url} (retry 3)`);
              
              try {
                const finalRetryResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-seo-elements-ds`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                  },
                  body: JSON.stringify({
                    pageId: job.page_id,
                    url: job.page_url,
                    modelName: 'deepseek-chat' // Try different model as last resort
                  })
                });

                if (finalRetryResponse.ok) {
                  const finalRetryResult = await finalRetryResponse.json();
                  if (finalRetryResult.success && finalRetryResult.seoElements) {
                    seoGenerated = true;
                    console.log(`Final AI retry successful for ${job.page_url}`);
                  }
                }
              } catch (finalRetryError) {
                console.error(`Final AI retry failed for ${job.page_url}:`, finalRetryError);
              }
            }
          }

          if (!seoGenerated) {
            throw new Error('Failed to generate SEO elements after multiple AI retry attempts');
          }

          // Track retry attempts for completion
          let retryAttempts = 0;
          let generationMethod = 'existing';
          
          if (!existingSeo?.h1 && !existingSeo?.primary_keyword) {
            generationMethod = 'ai_generation';
            
            // Count retries based on console logs (rough estimate)
            if (!seoGenerated) {
              retryAttempts = 3; // Failed after all retries
              generationMethod = 'ai_failed_after_retries';
            }
          }

          // Advance job to completion
          const { data: advanceResult, error: advanceError } = await supabaseClient
            .rpc('advance_pipeline_job', {
              job_id: job.job_id,
              next_stage: 'completed',
              stage_result: {
                seo_analysis_performed: seoAnalysisPerformed,
                seo_generated: seoGenerated,
                generation_method: generationMethod,
                retry_attempts: retryAttempts,
                timestamp: new Date().toISOString()
              }
            });

          if (advanceError || !advanceResult) {
            throw new Error(`Failed to advance job to completion: ${advanceError?.message || 'Unknown error'}`);
          }

          results.jobsSucceeded++;
          console.log(`Generation job ${job.job_id} completed successfully`);

        } catch (jobError) {
          console.error(`Error processing generation job ${job.job_id}:`, jobError);
          
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
        console.error('Error in generator worker loop:', error);
        results.errors.push(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }

    const endTime = Date.now();
    const duration = endTime - results.startTime;

    console.log(`Generator worker ${workerId} completed: ${results.jobsSucceeded}/${results.jobsProcessed} jobs in ${duration}ms`);

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
    console.error('Error in seo-pipeline-generator:', error);
    
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