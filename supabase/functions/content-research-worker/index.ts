import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob } from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import { startStage, completeStage, failStage } from '../_shared/stages.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

registerBeforeUnload(() => {
  console.log('content-research-worker terminating')
})

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
    console.error('Failed to pop message', error)
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
  const stage = message?.stage ?? 'research'
  const payload = message?.payload ?? {}

  if (!jobId) {
    console.warn('Message missing job_id, archiving')
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: 'invalid message archived' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (stage !== 'research') {
    console.log(`Research worker received stage ${stage}, forwarding`)
    await enqueueJob('content', jobId, stage, payload)
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: `forwarded stage ${stage}` }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEvent(jobId, 'processing', 'Research stage started', payload)
  const attempt = await startStage(jobId, 'research')
  const maxAttempts = Number(Deno.env.get('CONTENT_STAGE_MAX_ATTEMPTS') ?? '3')

  const work = (async () => {
    // TODO: Implement real research (search APIs, scraping, prompts)
    const researchResult = {
      note: 'Research worker placeholder - populate with real research outputs',
      payload,
      completed_at: new Date().toISOString(),
    }

    try {
      const { error: payloadError } = await supabaseAdmin
        .from('content_payloads')
        .upsert({ job_id: jobId, stage: 'research', data: researchResult })

      if (payloadError) {
        throw payloadError
      }

      await completeStage(jobId, 'research')

      await supabaseAdmin
        .from('content_jobs')
        .update({ stage: 'outline', status: 'queued' })
        .eq('id', jobId)

      await insertEvent(jobId, 'completed', 'Research stage completed')

      await enqueueJob('content', jobId, 'outline', { from: 'research-worker' })

      await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    } catch (workerError) {
      console.error('Research worker failure', workerError)
      await insertEvent(jobId, 'error', 'Research stage failed', { error: workerError })
      await failStage(jobId, 'research', workerError)

      if (attempt < maxAttempts) {
        await enqueueJob('content', jobId, 'research', payload)
      }
      await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    }
  })()

  runBackground(work)

  return new Response(JSON.stringify({ message: 'research stage scheduled', job_id: jobId, msg_id }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
