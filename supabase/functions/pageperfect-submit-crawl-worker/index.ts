// PagePerfect Submit Crawl Worker: Stage 1 - Submit crawl job and enqueue next stage
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEventForPipeline } from '../_shared/client.ts'
import {
  enqueueJob,
  dequeueNextJob,
  ackMessage,
  delayedRequeueJob,
  moveToDeadLetter,
  QueueMessage,
} from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import {
  startStageForPipeline,
  completeStageForPipeline,
  failStageForPipeline,
  shouldDeadLetterForPipeline,
} from '../_shared/stages.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

registerBeforeUnload(() => {
  console.log('pageperfect-submit-crawl-worker terminating')
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = Number(Deno.env.get('PAGEPERFECT_QUEUE_VISIBILITY') ?? '600')

  let record: QueueMessage | null = null
  try {
    record = await dequeueNextJob('pageperfect', visibility)
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
  const stage = message?.stage ?? 'submit_crawl'
  const payload = (message?.payload ?? {}) as Record<string, unknown>

  if (!jobId) {
    console.warn('Message missing job_id, acknowledging without processing')
    await ackMessage('pageperfect', msg_id)
    return new Response(JSON.stringify({ message: 'invalid message acknowledged' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (stage !== 'submit_crawl') {
    console.log(`Submit crawl worker received stage ${stage}, forwarding`)
    await enqueueJob('pageperfect', jobId, stage, payload, {
      priority: message?.priority ?? 0,
    })
    await ackMessage('pageperfect', msg_id)
    return new Response(JSON.stringify({ message: `forwarded stage ${stage}` }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const skipSteps = Array.isArray(payload.skip_steps) ? (payload.skip_steps as string[]) : []

  if (skipSteps.includes('submit_crawl')) {
    console.log(`Skipping submit_crawl stage for job ${jobId} per payload`)
    const stageInfo = await startStageForPipeline('pageperfect', jobId, 'submit_crawl')
    await completeStageForPipeline('pageperfect', jobId, 'submit_crawl')
    await insertEventForPipeline('pageperfect', jobId, 'skipped', 'Submit crawl stage skipped via payload', payload, stage)

    await supabaseAdmin
      .from('pageperfect_jobs')
      .update({
        stage: 'wait_crawl',
        status: 'queued',
        attempt_count: stageInfo.attempt_count,
      })
      .eq('id', jobId)

    await enqueueJob('pageperfect', jobId, 'wait_crawl', payload, {
      priority: stageInfo.priority,
    })

    await ackMessage('pageperfect', msg_id)

    return new Response(JSON.stringify({ message: 'submit_crawl stage skipped', job_id: jobId, msg_id }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEventForPipeline('pageperfect', jobId, 'processing', 'Submit crawl stage started', payload, stage)
  const stageInfo = await startStageForPipeline('pageperfect', jobId, 'submit_crawl')

  const work = (async () => {
    try {
      const url = payload.url as string
      const pageId = payload.page_id as string
      const premium = payload.premium as boolean
      const ultraPremium = payload.ultra_premium as boolean
      const render = payload.render as boolean

      // Create a crawl job
      const { data: crawlJob, error: crawlError } = await supabaseAdmin
        .from('crawl_jobs')
        .insert({
          url,
          page_id: pageId,
          status: 'pending',
          premium: premium ?? false,
          ultra_premium: ultraPremium ?? false,
          render: render ?? true,
        })
        .select()
        .single()

      if (crawlError || !crawlJob) {
        throw new Error(`Failed to create crawl job: ${crawlError?.message ?? 'No data returned'}`)
      }

      console.log(`Created crawl job ${crawlJob.id} for PagePerfect job ${jobId}`)

      // Store crawl job ID in payload
      const nextPayload = {
        ...payload,
        crawl_job_id: crawlJob.id,
      }

      // Save payload for next stage
      const { error: payloadError } = await supabaseAdmin
        .from('pageperfect_payloads')
        .upsert({ job_id: jobId, stage: 'submit_crawl', data: nextPayload })

      if (payloadError) {
        throw payloadError
      }

      await completeStageForPipeline('pageperfect', jobId, 'submit_crawl')

      await supabaseAdmin
        .from('pageperfect_jobs')
        .update({
          stage: 'wait_crawl',
          status: 'queued',
          attempt_count: stageInfo.attempt_count,
        })
        .eq('id', jobId)

      await insertEventForPipeline('pageperfect', jobId, 'completed', 'Submit crawl stage completed', {
        crawl_job_id: crawlJob.id,
      }, stage)

      // Enqueue wait_crawl stage
      await enqueueJob('pageperfect', jobId, 'wait_crawl', nextPayload, {
        priority: stageInfo.priority,
      })

      await ackMessage('pageperfect', msg_id)
    } catch (workerError) {
      console.error('Submit crawl worker failure', workerError)
      await insertEventForPipeline('pageperfect', jobId, 'error', 'Submit crawl stage failed', { error: workerError }, stage)
      await failStageForPipeline('pageperfect', jobId, 'submit_crawl', workerError)

      if (await shouldDeadLetterForPipeline('pageperfect', jobId, 'submit_crawl')) {
        await moveToDeadLetter(
          'pageperfect',
          msg_id,
          jobId,
          'submit_crawl',
          message,
          'max_attempts_exceeded',
          { error: workerError },
          stageInfo.attempt_count
        )
        return
      }

      await delayedRequeueJob('pageperfect', msg_id, jobId, 'submit_crawl', payload, {
        baseDelaySeconds: stageInfo.retry_delay_seconds,
        priorityOverride: stageInfo.priority,
        visibilitySeconds: visibility,
      })
    }
  })()

  runBackground(work)

  return new Response(JSON.stringify({ message: 'submit_crawl stage scheduled', job_id: jobId, msg_id }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
