import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import {
  enqueueJob,
  dequeueNextJob,
  ackMessage,
  delayedRequeueJob,
  moveToDeadLetter,
  QueueMessage,
} from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import { startStage, completeStage, failStage, shouldDeadLetter } from '../_shared/stages.ts'

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

  let record: QueueMessage | null = null
  try {
    record = await dequeueNextJob('content', visibility)
  } catch (error) {
    console.error('Failed to pop message', error)
    return new Response(JSON.stringify({ error: 'queue_pop_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!record) {
    return new Response(JSON.stringify({ message: 'no messages' }), {
      status: 204,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { msg_id, message } = record
  const jobId = message?.job_id
  const stage = message?.stage ?? 'research'
  const payload = (message?.payload ?? {}) as Record<string, unknown>

  if (!jobId) {
    console.warn('Message missing job_id, acknowledging without processing')
    await ackMessage('content', msg_id)
    return new Response(JSON.stringify({ message: 'invalid message acknowledged' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (stage !== 'research') {
    console.log(`Research worker received stage ${stage}, forwarding`)
    await enqueueJob('content', jobId, stage, payload, {
      priority: message?.priority ?? 0,
    })
    await ackMessage('content', msg_id)
    return new Response(JSON.stringify({ message: `forwarded stage ${stage}` }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEvent(jobId, 'processing', 'Research stage started', payload)
  const stageInfo = await startStage(jobId, 'research')

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
        .update({
          stage: 'outline',
          status: 'queued',
          attempt_count: stageInfo.attempt_count,
        })
        .eq('id', jobId)

      await insertEvent(jobId, 'completed', 'Research stage completed')

      await enqueueJob('content', jobId, 'outline', { from: 'research-worker' }, {
        priority: stageInfo.priority,
      })

      await ackMessage('content', msg_id)
    } catch (workerError) {
      console.error('Research worker failure', workerError)
      await insertEvent(jobId, 'error', 'Research stage failed', { error: workerError })
      await failStage(jobId, 'research', workerError)

      if (await shouldDeadLetter(jobId, 'research')) {
        await moveToDeadLetter(
          'content',
          msg_id,
          jobId,
          'research',
          message,
          'max_attempts_exceeded',
          { error: workerError },
          stageInfo.attempt_count,
        )
        return
      }

      await delayedRequeueJob('content', msg_id, jobId, 'research', payload, {
        baseDelaySeconds: stageInfo.retry_delay_seconds,
        priorityOverride: stageInfo.priority,
        visibilitySeconds: visibility,
      })
    }
  })()

  runBackground(work)

  return new Response(JSON.stringify({ message: 'research stage scheduled', job_id: jobId, msg_id }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
