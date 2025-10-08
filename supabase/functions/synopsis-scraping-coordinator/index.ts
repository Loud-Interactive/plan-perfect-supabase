// Supabase Edge Function: synopsis-scraping-coordinator
// Description: Manages parallel page scraping with concurrency control

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { ScrapingCoordinator, ScrapingConfig } from "../_shared/scraping-coordinator.ts"
import { CheckpointManager } from "../_shared/checkpointing.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

interface CoordinatorRequest {
  job_id: string;
  config?: Partial<ScrapingConfig>;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const { job_id, config }: CoordinatorRequest = await req.json()

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`Starting scraping coordinator for job ${job_id}`);

    // Check if job exists and is in correct state
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .eq('id', job_id)
      .single()

    if (jobError || !job) {
      throw new Error(`Job not found: ${job_id}`)
    }

    // Initialize checkpoint manager
    const checkpointManager = new CheckpointManager(supabase)

    // Check if we can resume from checkpoint
    const resumableState = await checkpointManager.canResumeFrom(job_id)
    if (resumableState.canResume) {
      console.log(`Resuming job from checkpoint at stage: ${resumableState.fromStage}`)
    }

    // Determine configuration based on job size and API health
    const scrapingConfig = await determineOptimalConfig(job, config)
    
    // Create coordinator
    const coordinator = new ScrapingCoordinator(supabase, scrapingConfig)

    // Start processing with checkpoint support
    const startTime = Date.now()
    
    try {
      // Save initial checkpoint
      await checkpointManager.saveCheckpoint(
        job_id,
        'page_scraping_started',
        {
          pages_discovered: job.total_pages || 0,
          pages_crawled: 0,
          pages_failed: 0,
          analyses_completed: [],
          analyses_failed: [],
          partial_results: {}
        },
        {
          scraping_config: scrapingConfig
        }
      )

      // Process all pages
      await coordinator.processJob(job_id)

      // Get final status
      const status = coordinator.getStatus()
      const elapsedTime = Date.now() - startTime

      // Update job progress
      const { data: finalStats } = await supabase
        .from('synopsis_page_tasks')
        .select('status')
        .eq('job_id', job_id)

      const completed = finalStats?.filter(t => t.status === 'completed').length || 0
      const failed = finalStats?.filter(t => t.status === 'failed').length || 0

      await supabase
        .from('synopsis_jobs')
        .update({ 
          completed_pages: completed,
          updated_at: new Date().toISOString()
        })
        .eq('id', job_id)

      // Save final checkpoint
      await checkpointManager.saveCheckpoint(
        job_id,
        'page_scraping_completed',
        {
          pages_discovered: job.total_pages || 0,
          pages_crawled: completed,
          pages_failed: failed,
          analyses_completed: [],
          analyses_failed: [],
          partial_results: {}
        },
        {
          elapsed_time_ms: elapsedTime,
          final_metrics: status.metrics
        }
      )

      // Trigger analysis if all critical pages are complete
      const criticalPagesComplete = await checkCriticalPagesComplete(job_id)
      if (criticalPagesComplete) {
        console.log('All critical pages complete, triggering analysis')
        await triggerAnalysis(job_id)
      }

      console.log(`Scraping completed for job ${job_id} in ${elapsedTime}ms`)

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job_id,
          pages_completed: completed,
          pages_failed: failed,
          elapsed_time_ms: elapsedTime,
          metrics: status.metrics,
          config_used: scrapingConfig
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )

    } catch (error) {
      // Save error checkpoint
      const errorCheckpoint = await checkpointManager.createCheckpointFromJobState(job_id, 'page_scraping_error')
      await checkpointManager.saveCheckpoint(
        job_id,
        'page_scraping_error',
        errorCheckpoint.progress,
        {
          error: error.message,
          elapsed_time_ms: Date.now() - startTime
        }
      )

      throw error
    }

  } catch (error) {
    console.error('Error in synopsis-scraping-coordinator:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/**
 * Determine optimal scraping configuration based on job and API health
 */
async function determineOptimalConfig(
  job: any,
  customConfig?: Partial<ScrapingConfig>
): Promise<ScrapingConfig> {
  // Check API health
  const { data: apiHealth } = await supabase
    .from('synopsis_api_health')
    .select('*')
    .eq('api_name', 'scraperapi')
    .single()

  const totalPages = job.total_pages || 10
  let maxConcurrency = 5
  let delayBetweenRequests = 1000

  // Adjust based on job size
  if (totalPages <= 5) {
    maxConcurrency = 2
    delayBetweenRequests = 500
  } else if (totalPages <= 10) {
    maxConcurrency = 3
    delayBetweenRequests = 750
  } else if (totalPages <= 20) {
    maxConcurrency = 5
    delayBetweenRequests = 1000
  } else {
    maxConcurrency = 8
    delayBetweenRequests = 1500
  }

  // Adjust based on API health
  if (apiHealth) {
    if (!apiHealth.is_healthy || apiHealth.circuit_breaker_state !== 'closed') {
      // Reduce concurrency if API is unhealthy
      maxConcurrency = Math.max(1, Math.floor(maxConcurrency / 2))
      delayBetweenRequests = delayBetweenRequests * 2
    }

    // Check quota usage
    if (apiHealth.daily_quota_limit && apiHealth.daily_quota_used) {
      const quotaUsage = apiHealth.daily_quota_used / apiHealth.daily_quota_limit
      if (quotaUsage > 0.7) {
        // Slow down if approaching quota limit
        maxConcurrency = Math.max(1, Math.floor(maxConcurrency * 0.5))
        delayBetweenRequests = delayBetweenRequests * 3
      }
    }
  }

  const config: ScrapingConfig = {
    maxConcurrency,
    batchSize: Math.min(10, totalPages),
    delayBetweenRequests,
    maxRetries: 3,
    timeout: 30000,
    adaptiveRateLimiting: true,
    ...customConfig // Allow custom overrides
  }

  console.log(`Determined optimal config for ${totalPages} pages:`, config)

  return config
}

/**
 * Check if all critical pages are complete
 */
async function checkCriticalPagesComplete(jobId: string): Promise<boolean> {
  const { data: job } = await supabase
    .from('synopsis_jobs')
    .select('total_pages, min_required_pages, partial_completion_allowed')
    .eq('id', jobId)
    .single()

  const totalPages = job?.total_pages ?? 0
  const baseThreshold = Math.ceil(Math.max(totalPages * 0.5, 3))
  const requiredPages = Math.max(job?.min_required_pages ?? baseThreshold, 1)

  const { data: tasks } = await supabase
    .from('synopsis_page_tasks')
    .select('status, is_critical')
    .eq('job_id', jobId)

  if (!tasks) {
    return false
  }

  const completedCount = tasks.filter(task => task.status === 'completed').length
  const criticalPending = tasks.some(task => task.is_critical && task.status !== 'completed')

  if (!criticalPending && totalPages > 0 && completedCount >= totalPages) {
    return true
  }

  if (job?.partial_completion_allowed && !criticalPending && completedCount >= requiredPages) {
    return true
  }

  return false
}

/**
 * Trigger analysis phase
 */
async function triggerAnalysis(jobId: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/synopsis-analyzer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId
      })
    })
  } catch (error) {
    console.error('Failed to trigger analysis:', error)
    // Don't throw - analysis can be triggered separately
  }
}
