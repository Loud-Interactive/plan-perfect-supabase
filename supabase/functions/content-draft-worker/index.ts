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
const STAGE_NAME = 'draft'

type DraftPayload = {
  subsection_idx?: number
  total_sections?: number
} & Record<string, unknown>

interface DraftProgress {
  completed_subsections: number
  next_subsection_to_enqueue: number | null
  total_sections: number
  qa_enqueued?: boolean
}

interface DraftState {
  sections: string[]
  progress?: Partial<DraftProgress>
}

registerBeforeUnload(() => console.log('content-draft-worker terminating'))

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const handleDraftStage: StageHandler<DraftPayload> = async ({ jobId, payload, stageInfo }) => {
  await insertEvent(jobId, 'processing', 'Draft stage started', payload)

  const { data: existing } = await supabaseAdmin
    .from('content_payloads')
    .select('data')
    .eq('job_id', jobId)
    .eq('stage', 'draft')
    .maybeSingle()

  const draftData = (existing?.data ?? {}) as DraftState
  const sections = Array.isArray(draftData.sections) ? [...draftData.sections] : []

  const rawProgress = draftData.progress ?? {}
  const progress: DraftProgress = {
    completed_subsections: asNumber(rawProgress.completed_subsections, -1),
    next_subsection_to_enqueue:
      rawProgress.next_subsection_to_enqueue === null || rawProgress.next_subsection_to_enqueue === undefined
        ? null
        : asNumber(rawProgress.next_subsection_to_enqueue, -1),
    total_sections: Math.max(asNumber(rawProgress.total_sections, 0), 0),
    qa_enqueued: Boolean(rawProgress.qa_enqueued),
  }

  let totalSections = asNumber(payload?.total_sections, 0)
  if (totalSections <= 0) {
    totalSections = progress.total_sections > 0 ? progress.total_sections : Math.max(sections.length, 1)
  }
  totalSections = Math.max(totalSections, 1)
  progress.total_sections = totalSections

  let subsection = asNumber(payload?.subsection_idx, progress.completed_subsections + 1)
  if (subsection < 0) {
    subsection = Math.max(progress.completed_subsections + 1, 0)
  }
  if (subsection >= totalSections) {
    subsection = totalSections - 1
  }

  const alreadyCompleted = subsection <= progress.completed_subsections
  if (!alreadyCompleted) {
    const draftSnippet = `# Draft subsection ${subsection}\n\nThis is placeholder content generated during migration.`
    sections[subsection] = draftSnippet
    progress.completed_subsections = subsection
  }

  draftData.sections = sections

  const nextSubsection = progress.completed_subsections + 1
  let stageComplete = progress.completed_subsections >= totalSections - 1

  if (!stageComplete) {
    const nextIndex = Math.min(nextSubsection, totalSections - 1)
    const alreadyEnqueued =
      progress.next_subsection_to_enqueue !== null && progress.next_subsection_to_enqueue >= nextIndex

    if (nextIndex < totalSections && !alreadyEnqueued) {
      await enqueueJob(QUEUE_NAME, jobId, 'draft', {
        subsection_idx: nextIndex,
        total_sections: totalSections,
      })
      progress.next_subsection_to_enqueue = nextIndex
    }
  } else {
    progress.next_subsection_to_enqueue = null
    if (!progress.qa_enqueued) {
      await supabaseAdmin
        .from('content_jobs')
        .update({ stage: 'qa', status: 'queued', attempt_count: stageInfo.attempt_count })
        .eq('id', jobId)

      await enqueueJob(QUEUE_NAME, jobId, 'qa', {})
      await insertEvent(jobId, 'completed', 'Draft stage completed')
      progress.qa_enqueued = true
    }
  }

  draftData.progress = progress

  const { error: upsertError } = await supabaseAdmin
    .from('content_payloads')
    .upsert({ job_id: jobId, stage: 'draft', data: draftData })

  if (upsertError) {
    throw upsertError
  }

  return { complete: stageComplete }
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
    console.error('Failed to dequeue draft messages', error)
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
      handler: handleDraftStage,
    })
  })

  return new Response(
    JSON.stringify({ message: 'draft batch scheduled', count: records.length }),
    {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
