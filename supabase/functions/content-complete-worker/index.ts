import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { batchDequeueJobs } from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import { processStageBatch, type StageHandler } from '../_shared/stage-runner.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const QUEUE_NAME = 'content'
const STAGE_NAME = 'complete'

registerBeforeUnload(() => console.log('content-complete-worker terminating'))

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

const handleCompletionStage: StageHandler<Record<string, unknown>> = async ({ jobId }) => {
  await insertEvent(jobId, 'completed', 'Job fully completed')
  await supabaseAdmin
    .from('content_jobs')
    .update({ status: 'completed', stage: STAGE_NAME })
    .eq('id', jobId)
  return { complete: true }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = parseIntegerEnv(Deno.env.get('CONTENT_QUEUE_VISIBILITY'), 600)
  const batchSize = parseIntegerEnv(Deno.env.get('CONTENT_QUEUE_BATCH_SIZE'), 10)

  let records
  try {
    records = await batchDequeueJobs(QUEUE_NAME, visibility, batchSize)
  } catch (error) {
    console.error('Failed to dequeue completion messages', error)
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
      handler: handleCompletionStage,
    })
  })

  return new Response(
    JSON.stringify({ message: 'completion batch scheduled', count: records.length }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
