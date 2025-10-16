import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob, batchDequeueJobs } from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import { processStageBatch, type StageHandler } from '../_shared/stage-runner.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const QUEUE_NAME = 'content'
const STAGE_NAME = 'outline'

type OutlinePayload = Record<string, unknown>

registerBeforeUnload(() => console.log('content-outline-worker terminating'))

const handleOutlineStage: StageHandler<OutlinePayload> = async ({ jobId, payload, stageInfo }) => {
  await insertEvent(jobId, 'processing', 'Outline stage started', payload)

  const outlineResult = {
    note: 'Outline worker placeholder - replace with real outline logic',
    sections: [],
    completed_at: new Date().toISOString(),
  }

  const { error: payloadError } = await supabaseAdmin
    .from('content_payloads')
    .upsert({ job_id: jobId, stage: 'outline', data: outlineResult })

  if (payloadError) {
    throw payloadError
  }

  await supabaseAdmin
    .from('content_jobs')
    .update({ stage: 'draft', status: 'queued', attempt_count: stageInfo.attempt_count })
    .eq('id', jobId)

  await insertEvent(jobId, 'completed', 'Outline stage completed')

  await enqueueJob(
    QUEUE_NAME,
    jobId,
    'draft',
    { from: 'outline-worker' },
    { priority: stageInfo.priority }
  )

  return { complete: true }
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = parseIntegerEnv(Deno.env.get('CONTENT_QUEUE_VISIBILITY'), 600)
  const batchSize = parseIntegerEnv(Deno.env.get('CONTENT_QUEUE_BATCH_SIZE'), 5)

  let records
  try {
    records = await batchDequeueJobs(QUEUE_NAME, visibility, batchSize)
  } catch (error) {
    console.error('Failed to dequeue outline messages', error)
    return new Response(JSON.stringify({ error: 'queue_pop_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!records || records.length === 0) {
    return new Response(JSON.stringify({ message: 'no messages' }), {
      status: 204,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  runBackground(async () => {
    await processStageBatch(records, {
      queue: QUEUE_NAME,
      expectedStage: STAGE_NAME,
      visibilitySeconds: visibility,
      handler: handleOutlineStage,
    })
  })

  return new Response(
    JSON.stringify({ message: 'outline batch scheduled', count: records.length }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
