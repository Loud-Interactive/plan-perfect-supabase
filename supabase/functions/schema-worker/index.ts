import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { startStage, completeStage, failStage } from '../_shared/stages.ts'

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

  const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
    p_queue: 'schema',
    p_visibility: Number(Deno.env.get('SCHEMA_QUEUE_VISIBILITY') ?? '300'),
  })
  if (error) {
    console.error('Failed to pop schema message', error)
    return new Response(JSON.stringify({ error: 'queue_pop_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!data || data.length === 0) {
    return new Response(JSON.stringify({ message: 'no messages' }), {
      status: 204,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const record = data[0] as { msg_id: number; message: { job_id: string; stage?: string; payload?: Record<string, unknown> } }
  const { msg_id, message } = record
  const jobId = message?.job_id
  const stage = message?.stage ?? 'schema-generation'
  const payload = message?.payload ?? {}

  if (!jobId) {
    await supabaseAdmin.rpc('archive_message', { p_queue: 'schema', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: 'invalid message archived' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEvent(jobId, 'processing', 'Schema stage started', payload)
  const attempt = await startStage(jobId, stage)
  const maxAttempts = Number(Deno.env.get('SCHEMA_STAGE_MAX_ATTEMPTS') ?? '3')

  try {
    const schemaResult = {
      note: 'Schema worker placeholder - convert HTML to JSON-LD',
      payload,
      generated_at: new Date().toISOString(),
    }

    const { error: payloadError } = await supabaseAdmin
      .from('content_payloads')
      .upsert({ job_id: jobId, stage: stage, data: schemaResult })

    if (payloadError) {
      throw payloadError
    }

    await completeStage(jobId, stage)
    await supabaseAdmin
      .from('content_jobs')
      .update({ status: 'completed', stage: 'complete', result: schemaResult })
      .eq('id', jobId)
    await insertEvent(jobId, 'completed', 'Schema generation completed')
  } catch (workerError) {
    console.error('Schema worker failure', workerError)
    await insertEvent(jobId, 'error', 'Schema generation failed', { error: workerError })
    await failStage(jobId, stage, workerError)
    if (attempt < maxAttempts) {
      await supabaseAdmin.rpc('enqueue_stage', { p_queue: 'schema', p_job_id: jobId, p_stage: stage, p_payload: payload })
    }
  } finally {
    await supabaseAdmin.rpc('archive_message', { p_queue: 'schema', p_msg_id: msg_id })
  }

  return new Response(JSON.stringify({ message: 'schema stage processed', job_id: jobId }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
