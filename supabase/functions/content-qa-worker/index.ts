import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob } from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import { startStage, completeStage, failStage } from '../_shared/stages.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

registerBeforeUnload(() => console.log('content-qa-worker terminating'))

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = Number(Deno.env.get('CONTENT_QUEUE_VISIBILITY') ?? '600')
  const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
    p_queue: 'content',
    p_visibility: visibility,
  })
  if (error) {
    console.error('Failed to pop qa message', error)
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
  const stage = message?.stage ?? 'qa'

  if (!jobId) {
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: 'invalid message archived' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (stage !== 'qa') {
    await enqueueJob('content', jobId, stage, message?.payload ?? {})
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: `forwarded stage ${stage}` }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEvent(jobId, 'processing', 'QA stage started')
  const attempt = await startStage(jobId, 'qa')
  const maxAttempts = Number(Deno.env.get('CONTENT_STAGE_MAX_ATTEMPTS') ?? '3')

  const work = (async () => {
    try {
      const qaResult = {
        note: 'QA worker placeholder - implement grammar/style checks via LLM',
        approved_at: new Date().toISOString(),
      }

      const { error: payloadError } = await supabaseAdmin
        .from('content_payloads')
        .upsert({ job_id: jobId, stage: 'qa', data: qaResult })

      if (payloadError) {
        throw payloadError
      }

      await completeStage(jobId, 'qa')

      await supabaseAdmin
        .from('content_jobs')
        .update({ stage: 'distribution', status: 'queued' })
        .eq('id', jobId)

      await insertEvent(jobId, 'completed', 'QA stage completed')

      await enqueueJob('content', jobId, 'distribution', {})
      await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    } catch (workerError) {
      console.error('QA worker failure', workerError)
      await insertEvent(jobId, 'error', 'QA stage failed', { error: workerError })
      await failStage(jobId, 'qa', workerError)
      if (attempt < maxAttempts) {
        await enqueueJob('content', jobId, 'qa', message?.payload ?? {})
      }
      await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    }
  })()

  runBackground(work)

  return new Response(JSON.stringify({ message: 'qa stage scheduled', job_id: jobId }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
