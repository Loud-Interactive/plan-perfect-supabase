// supabase/functions/rescue-stuck-outlines/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }

  try {
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )

    // Parse request body for configuration
    const { 
      stuckTimeMinutes = 30,
      batchSize = 10,
      processingTimeoutMinutes = 15,
      retryFailedSearches = true
    } = await req.json()

    console.log(`Starting stuck outline rescue operation with params:`)
    console.log(`- stuckTimeMinutes: ${stuckTimeMinutes}`)
    console.log(`- batchSize: ${batchSize}`)
    console.log(`- processingTimeoutMinutes: ${processingTimeoutMinutes}`)
    console.log(`- retryFailedSearches: ${retryFailedSearches}`)

    // Get current timestamp
    const now = new Date()
    
    // Calculate cutoff time for stuck jobs (e.g., jobs that haven't updated in 30 minutes)
    const stuckJobsCutoff = new Date(now.getTime() - (stuckTimeMinutes * 60 * 1000))
    const stuckJobsCutoffStr = stuckJobsCutoff.toISOString()
    
    console.log(`Looking for jobs stuck before: ${stuckJobsCutoffStr}`)

    // Find stuck outline generation jobs in "search_queued" status or with stalled heartbeats
    const { data: stuckJobs, error: stuckJobsError } = await supabaseClient
      .from('outline_generation_jobs')
      .select('*')
      .or(`status.eq.search_queued,and(heartbeat_at.lt.${stuckJobsCutoffStr},status.not.in.(completed,failed))`)
      .lt('updated_at', stuckJobsCutoffStr)
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (stuckJobsError) {
      throw stuckJobsError
    }

    console.log(`Found ${stuckJobs?.length || 0} stuck jobs (search_queued or with stalled heartbeats)`)

    const results = {
      stuck_jobs_found: stuckJobs?.length || 0,
      stuck_jobs_processed: 0,
      stuck_terms_reset: 0,
      stuck_jobs_requeued: 0,
      errors: []
    }

    // Process each stuck job
    for (const job of stuckJobs || []) {
      try {
        console.log(`Processing stuck job: ${job.id}`)
        
        // Calculate cutoff time for stuck processing terms
        const processingTermsCutoff = new Date(now.getTime() - (processingTimeoutMinutes * 60 * 1000))
        const processingTermsCutoffStr = processingTermsCutoff.toISOString()

        // 1. Find terms stuck in "processing" status
        const { data: stuckTerms, error: stuckTermsError } = await supabaseClient
          .from('outline_search_queue')
          .select('*')
          .eq('job_id', job.id)
          .eq('status', 'processing')
          .lt('updated_at', processingTermsCutoffStr)

        if (stuckTermsError) {
          throw stuckTermsError
        }

        console.log(`Found ${stuckTerms?.length || 0} terms stuck in processing status`)
        
        // 2. Reset stuck terms to "pending" status for retry
        if (stuckTerms && stuckTerms.length > 0) {
          const { error: resetError } = await supabaseClient
            .from('outline_search_queue')
            .update({ 
              status: 'pending',
              attempts: supabaseClient.sql`attempts + 1`,
              updated_at: now.toISOString()
            })
            .eq('job_id', job.id)
            .eq('status', 'processing')
            .lt('updated_at', processingTermsCutoffStr)

          if (resetError) {
            throw resetError
          }
          
          results.stuck_terms_reset += stuckTerms.length
          console.log(`Reset ${stuckTerms.length} stuck terms to pending status`)
        }

        // 3. Optionally retry failed search terms
        if (retryFailedSearches) {
          const { data: failedTerms, error: failedTermsError } = await supabaseClient
            .from('outline_search_queue')
            .select('*')
            .eq('job_id', job.id)
            .eq('status', 'failed')

          if (failedTermsError) {
            throw failedTermsError
          }

          if (failedTerms && failedTerms.length > 0) {
            const { error: retryError } = await supabaseClient
              .from('outline_search_queue')
              .update({ 
                status: 'pending',
                attempts: supabaseClient.sql`attempts + 1`,
                updated_at: now.toISOString()
              })
              .eq('job_id', job.id)
              .eq('status', 'failed')

            if (retryError) {
              throw retryError
            }
            
            console.log(`Reset ${failedTerms.length} failed terms to pending status`)
          }
        }

        // 4. Check if there are any remaining pending terms
        const { count: pendingCount, error: pendingCountError } = await supabaseClient
          .from('outline_search_queue')
          .select('*', { count: 'exact', head: true })
          .eq('job_id', job.id)
          .eq('status', 'pending')

        if (pendingCountError) {
          throw pendingCountError
        }

        // 5. If there are pending terms, trigger the search queue processor
        if (pendingCount && pendingCount > 0) {
          console.log(`Job ${job.id} has ${pendingCount} pending terms, triggering process-search-queue`)
          
          // Trigger the process-search-queue function to continue processing
          const processResponse = await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-search-queue`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({ job_id: job.id })
            }
          )

          if (!processResponse.ok) {
            const errorText = await processResponse.text()
            throw new Error(`Failed to trigger process-search-queue: ${errorText}`)
          }

          // Add status update record
          await supabaseClient
            .from('content_plan_outline_statuses')
            .insert({
              outline_job_id: job.id,
              status: 'Rescuing stuck search terms...',
              outline_guid: job.id
            })

          results.stuck_jobs_requeued++
          console.log(`Successfully triggered process-search-queue for job ${job.id}`)
        } else {
          // No pending terms found, check if we should force completion
          console.log(`No pending terms found for job ${job.id}, checking if job can be moved to next stage`)
          
          // Check if any search results were found for this job
          const { count: resultsCount, error: resultsCountError } = await supabaseClient
            .from('outline_search_results')
            .select('*', { count: 'exact', head: true })
            .eq('job_id', job.id)

          if (resultsCountError) {
            throw resultsCountError
          }

          if (resultsCount && resultsCount > 0) {
            // We have some search results, transition the job to search_completed status
            const { error: updateJobError } = await supabaseClient
              .from('outline_generation_jobs')
              .update({
                status: 'search_completed',
                updated_at: now.toISOString()
              })
              .eq('id', job.id)

            if (updateJobError) {
              throw updateJobError
            }

            // Add status update record
            await supabaseClient
              .from('content_plan_outline_statuses')
              .insert({
                outline_job_id: job.id,
                status: 'Search completed (rescued from stuck state)',
                outline_guid: job.id
              })

            // Trigger the analyze-outline-content function to proceed with the next step
            const analyzeResponse = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-outline-content`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                },
                body: JSON.stringify({ job_id: job.id })
              }
            )

            if (!analyzeResponse.ok) {
              const errorText = await analyzeResponse.text()
              throw new Error(`Failed to trigger analyze-outline-content: ${errorText}`)
            }

            console.log(`Successfully moved job ${job.id} to search_completed and triggered analysis`)
          } else {
            // No search results found, send back to search generation stage
            console.log(`No search results found for job ${job.id}, will need manual review`)
            
            // Add status update record indicating a problem
            await supabaseClient
              .from('content_plan_outline_statuses')
              .insert({
                outline_job_id: job.id,
                status: 'Rescue attempt failed: No search results found',
                outline_guid: job.id
              })
          }
        }

        results.stuck_jobs_processed++
      } catch (jobError) {
        console.error(`Error processing job ${job.id}: ${jobError.message}`)
        results.errors.push({
          job_id: job.id,
          error: jobError.message
        })
        
        // Log the error in the status table
        await supabaseClient
          .from('content_plan_outline_statuses')
          .insert({
            outline_job_id: job.id,
            status: `Error during rescue: ${jobError.message}`,
            outline_guid: job.id
          })
      }
    }

    return new Response(
      JSON.stringify(results),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error(`Unhandled error: ${error.message}`)
    
    return new Response(
      JSON.stringify({ 
        error: `An unexpected error occurred: ${error.message}` 
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})