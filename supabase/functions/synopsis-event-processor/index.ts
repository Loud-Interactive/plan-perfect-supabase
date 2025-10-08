import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

interface SynopsisEvent {
  id: string
  job_id: string
  event_type: string
  event_data: any
  process_after: string
  error_count: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  let processed = 0
  let errors = 0

  try {
    // Get unprocessed events that are ready to process
    const { data: events, error: fetchError } = await supabase
      .from('synopsis_events')
      .select('*')
      .eq('processed', false)
      .lte('process_after', new Date().toISOString())
      .lt('error_count', 3) // Don't process events that failed 3 times
      .order('created_at', { ascending: true })
      .limit(10)

    if (fetchError) {
      console.error('Error fetching events:', fetchError)
      throw fetchError
    }

    console.log(`Processing ${events?.length || 0} events`)

    // Process each event
    for (const event of events || []) {
      try {
        console.log(`Processing event ${event.id} of type ${event.event_type}`)
        
        let success = false
        switch (event.event_type) {
          case 'start_crawling':
            success = await handleStartCrawling(event)
            break
            
          case 'start_analysis':
            success = await handleStartAnalysis(event)
            break
            
          case 'ready_to_finalize':
            success = await handleFinalization(event)
            break
            
          case 'retry_needed':
            success = await handleRetry(event)
            break
            
          case 'phase_complete':
            success = await handlePhaseComplete(event)
            break
            
          default:
            console.warn(`Unknown event type: ${event.event_type}`)
            success = true // Mark as processed to avoid stuck events
        }

        if (success) {
          // Mark event as processed
          await supabase
            .from('synopsis_events')
            .update({ 
              processed: true, 
              processed_at: new Date().toISOString() 
            })
            .eq('id', event.id)
            
          processed++
        } else {
          // Increment error count and delay next attempt
          await supabase
            .from('synopsis_events')
            .update({ 
              error_count: event.error_count + 1,
              last_error: 'Processing failed',
              process_after: new Date(Date.now() + Math.pow(2, event.error_count) * 60000).toISOString() // Exponential backoff
            })
            .eq('id', event.id)
            
          errors++
        }
      } catch (error) {
        console.error(`Error processing event ${event.id}:`, error)
        
        // Update error info
        await supabase
          .from('synopsis_events')
          .update({ 
            error_count: event.error_count + 1,
            last_error: error.message,
            process_after: new Date(Date.now() + 5 * 60000).toISOString() // Retry in 5 minutes
          })
          .eq('id', event.id)
          
        errors++
      }
    }

    // Clean up old processed events
    await cleanupOldEvents()

    const duration = Date.now() - startTime
    return new Response(
      JSON.stringify({ 
        success: true,
        processed,
        errors,
        duration_ms: duration
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error in event processor:', error)
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

async function handleStartCrawling(event: SynopsisEvent): Promise<boolean> {
  const { job_id, event_data } = event
  
  // Update job status
  await supabase
    .from('synopsis_jobs')
    .update({ 
      status: 'discovering_pages',
      phase_started_at: new Date().toISOString()
    })
    .eq('id', job_id)
  
  // Trigger page discovery
  const response = await fetch(`${supabaseUrl}/functions/v1/synopsis-page-discovery`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      job_id: job_id,
      domain_url: event_data.domain ? `https://${event_data.domain}/` : event_data.domain_url
    })
  })
  
  // Fire and forget - don't wait for response
  console.log(`Triggered page discovery for job ${job_id}`)
  return true
}

async function handleStartAnalysis(event: SynopsisEvent): Promise<boolean> {
  const { job_id } = event
  
  // Update job status
  await supabase
    .from('synopsis_jobs')
    .update({ 
      status: 'analyzing',
      phase_started_at: new Date().toISOString()
    })
    .eq('id', job_id)
  
  // Create analysis tasks
  const { data: created } = await supabase.rpc('create_analysis_chunks', {
    p_job_id: job_id,
    p_chunk_size: 3
  })
  
  console.log(`Created ${created} analysis tasks for job ${job_id}`)
  
  // Get chunks to process
  const { data: chunks } = await supabase
    .from('synopsis_analysis_tasks')
    .select('chunk_id')
    .eq('job_id', job_id)
    .order('chunk_id')
  
  const uniqueChunks = [...new Set(chunks?.map(c => c.chunk_id) || [])]
  
  // Start processing chunks with delay
  for (const chunkId of uniqueChunks) {
    setTimeout(async () => {
      try {
        await fetch(`${supabaseUrl}/functions/v1/synopsis-analyzer`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            job_id: job_id,
            chunk_id: chunkId
          })
        })
        console.log(`Started analyzer for job ${job_id}, chunk ${chunkId}`)
      } catch (error) {
        console.error(`Failed to start analyzer for chunk ${chunkId}:`, error)
      }
    }, (chunkId - 1) * 5000) // 5 second delay between chunks
  }
  
  return true
}

async function handleFinalization(event: SynopsisEvent): Promise<boolean> {
  const { job_id, event_data } = event
  
  console.log(`Starting finalization for job ${job_id} with ${event_data.completed_analyses} analyses`)
  
  // Update job status
  await supabase
    .from('synopsis_jobs')
    .update({ 
      status: 'finalizing',
      phase_started_at: new Date().toISOString()
    })
    .eq('id', job_id)
  
  // Trigger finalizer
  const response = await fetch(`${supabaseUrl}/functions/v1/synopsis-finalizer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ job_id })
  })
  
  console.log(`Triggered finalizer for job ${job_id}`)
  return true
}

async function handleRetry(event: SynopsisEvent): Promise<boolean> {
  const { job_id, event_data } = event
  const { current_phase, retry_count } = event_data
  
  console.log(`Retrying job ${job_id} in phase ${current_phase} (attempt ${retry_count})`)
  
  // Update retry count
  await supabase
    .from('synopsis_jobs')
    .update({ 
      retry_count,
      last_heartbeat: new Date().toISOString()
    })
    .eq('id', job_id)
  
  // Create appropriate event based on current phase
  let newEventType = 'start_crawling'
  if (current_phase === 'crawling_pages' || current_phase === 'pages_crawled') {
    newEventType = 'start_analysis'
  } else if (current_phase === 'analyzing') {
    newEventType = 'ready_to_finalize'
  }
  
  // Create new event to retry the phase
  await supabase
    .from('synopsis_events')
    .insert({
      job_id,
      event_type: newEventType,
      event_data: { ...event_data, retry: true }
    })
  
  return true
}

async function handlePhaseComplete(event: SynopsisEvent): Promise<boolean> {
  const { job_id, event_data } = event
  const { phase, next_phase } = event_data
  
  console.log(`Phase ${phase} completed for job ${job_id}, transitioning to ${next_phase}`)
  
  // Update heartbeat
  await supabase
    .from('synopsis_jobs')
    .update({ last_heartbeat: new Date().toISOString() })
    .eq('id', job_id)
  
  return true
}

async function cleanupOldEvents(): Promise<void> {
  try {
    // Delete processed events older than 1 day
    const { error } = await supabase
      .from('synopsis_events')
      .delete()
      .eq('processed', true)
      .lt('processed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    
    if (error) {
      console.error('Error cleaning up old events:', error)
    }
  } catch (error) {
    console.error('Error in cleanup:', error)
  }
}