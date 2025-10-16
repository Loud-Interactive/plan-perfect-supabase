import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'

interface IntakeRequest {
  job_type?: string
  requester_email?: string
  payload?: Record<string, unknown>
  initial_stage?: string
  priority?: number
  max_attempts?: number
  retry_delay_seconds?: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as IntakeRequest
    const jobType = body.job_type
    if (!jobType) {
      return new Response(JSON.stringify({ error: 'job_type is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = body.payload ?? {}
    const initialStage = body.initial_stage ?? 'research'
    const priority = body.priority ?? 0
    const maxAttempts = body.max_attempts ?? 5
    const retryDelaySeconds = body.retry_delay_seconds ?? 60

    const { data, error } = await supabaseAdmin.rpc('create_content_job', {
      p_job_type: jobType,
      p_requester_email: body.requester_email,
      p_payload: payload,
      p_initial_stage: initialStage,
      p_priority: priority,
      p_max_attempts: maxAttempts,
      p_retry_delay_seconds: retryDelaySeconds,
      p_queue_override: jobType === 'schema' ? 'schema' : null,
    })

    if (error || !data) {
      console.error('Failed to insert job', error)
      return new Response(JSON.stringify({ error: 'Failed to insert job' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jobId = data as string
    await insertEvent(jobId, 'queued', 'Job queued by intake', {
      payload_keys: Object.keys(payload),
      priority,
      max_attempts: maxAttempts,
      retry_delay_seconds: retryDelaySeconds,
    })

    return new Response(JSON.stringify({ job_id: jobId, status: 'queued', stage: initialStage }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Intake error', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
