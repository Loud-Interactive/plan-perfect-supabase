import { supabaseAdmin, recordMetric } from './client.ts'

export interface StageInfo {
  attempt_count: number
  max_attempts: number
  retry_delay_seconds: number
  priority: number
  status: string
  dead_lettered_at?: string
  started_at?: string
}

type Pipeline = 'content' | 'pageperfect'

export interface StageContext {
  queue?: string
  messageId?: number
  enqueuedAt?: string
  availableAt?: string
  dequeuedAt?: string
}

export interface StageCompletionContext {
  queue?: string
  messageId?: number
}

function getStagesTable(pipeline: Pipeline): string {
  return pipeline === 'content' ? 'content_job_stages' : 'pageperfect_job_stages'
}

function getJobsTable(pipeline: Pipeline): string {
  return pipeline === 'content' ? 'content_jobs' : 'pageperfect_jobs'
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function computeQueueLatency(now: Date, context: StageContext): number | undefined {
  if (context.availableAt) {
    const availableAt = new Date(context.availableAt)
    return now.getTime() - availableAt.getTime()
  }
  if (context.enqueuedAt) {
    const enqueuedAt = new Date(context.enqueuedAt)
    return now.getTime() - enqueuedAt.getTime()
  }
  return undefined
}

function buildMetricMetadata(base: Record<string, unknown>, additions: Record<string, unknown | undefined>) {
  const metadata: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined && value !== null) {
      metadata[key] = value
    }
  }
  return metadata
}

export async function startStageForPipeline(
  pipeline: Pipeline,
  jobId: string,
  stage: string,
  context: StageContext = {}
): Promise<StageInfo> {
  const stagesTable = getStagesTable(pipeline)
  const startTime = context.dequeuedAt ? new Date(context.dequeuedAt) : new Date()
  const startIso = startTime.toISOString()

  const { data, error } = await supabaseAdmin
    .from(stagesTable)
    .select('attempt_count, max_attempts, retry_delay_seconds, priority, status, dead_lettered_at')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  const currentAttempt = data?.attempt_count ?? 0
  const nextAttempt = currentAttempt + 1
  const maxAttempts = data?.max_attempts ?? 5
  const retryDelay = data?.retry_delay_seconds ?? 60
  const priority = data?.priority ?? 0

  const { error: upsertError } = await supabaseAdmin
    .from(stagesTable)
    .upsert({
      job_id: jobId,
      stage,
      status: 'processing',
      attempt_count: nextAttempt,
      max_attempts: maxAttempts,
      retry_delay_seconds: retryDelay,
      priority,
      started_at: startIso,
      finished_at: null,
      last_error: null,
    })

  if (error || upsertError) {
    console.error(`Failed to start ${pipeline} stage`, stage, error ?? upsertError)
  }

  if (pipeline === 'content') {
    const queueLatencyMs = computeQueueLatency(startTime, context)
    console.log(
      JSON.stringify({
        type: 'stage_started',
        pipeline,
        job_id: jobId,
        stage,
        attempt: nextAttempt,
        max_attempts: maxAttempts,
        priority,
        queue: context.queue,
        message_id: context.messageId,
        queue_latency_ms: queueLatencyMs,
        timestamp: startIso,
      })
    )

    await recordMetric({
      jobId,
      stage,
      metricType: 'attempt',
      value: 1,
      messageId: context.messageId,
      attempt: nextAttempt,
      priority,
      metadata: buildMetricMetadata(
        { max_attempts: maxAttempts },
        { queue: context.queue, queue_latency_ms: queueLatencyMs }
      ),
    })
  }

  return {
    attempt_count: nextAttempt,
    max_attempts: maxAttempts,
    retry_delay_seconds: retryDelay,
    priority,
    status: 'processing',
    started_at: startIso,
  }
}

export async function completeStageForPipeline(
  pipeline: Pipeline,
  jobId: string,
  stage: string,
  context: StageCompletionContext = {}
) {
  const stagesTable = getStagesTable(pipeline)
  const jobsTable = getJobsTable(pipeline)
  const finishedAt = new Date()
  const finishedIso = finishedAt.toISOString()

  const { data: stageData } = await supabaseAdmin
    .from(stagesTable)
    .select('started_at, attempt_count, priority')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  const { error } = await supabaseAdmin
    .from(stagesTable)
    .update({
      status: 'completed',
      finished_at: finishedIso,
      next_retry_at: null,
      last_error: null,
    })
    .eq('job_id', jobId)
    .eq('stage', stage)

  if (error) {
    console.error(`Failed to mark ${pipeline} stage complete`, stage, error)
  }

  await supabaseAdmin
    .from(jobsTable)
    .update({
      status: 'processing',
      last_completed_at: finishedIso,
    })
    .eq('id', jobId)

  if (pipeline === 'content') {
    const attemptCount = stageData?.attempt_count
    const priority = stageData?.priority
    const startedAt = stageData?.started_at ? new Date(stageData.started_at) : undefined
    const durationMs = startedAt ? finishedAt.getTime() - startedAt.getTime() : undefined

    console.log(
      JSON.stringify({
        type: 'stage_completed',
        pipeline,
        job_id: jobId,
        stage,
        duration_ms: durationMs,
        attempt: attemptCount,
        priority,
        queue: context.queue,
        message_id: context.messageId,
        timestamp: finishedIso,
      })
    )

    if (durationMs !== undefined) {
      await recordMetric({
        jobId,
        stage,
        metricType: 'duration',
        value: durationMs,
        messageId: context.messageId,
        attempt: attemptCount,
        priority,
        metadata: buildMetricMetadata(
          { status: 'completed' },
          { queue: context.queue, started_at: stageData?.started_at, finished_at: finishedIso }
        ),
      })
    }
  }
}

export async function failStageForPipeline(
  pipeline: Pipeline,
  jobId: string,
  stage: string,
  error: unknown,
  context: StageCompletionContext = {}
) {
  const stagesTable = getStagesTable(pipeline)
  const jobsTable = getJobsTable(pipeline)
  const finishedAt = new Date()
  const finishedIso = finishedAt.toISOString()

  const { data } = await supabaseAdmin
    .from(stagesTable)
    .select('attempt_count, max_attempts, retry_delay_seconds, priority, started_at')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  const attemptCount = data?.attempt_count ?? 1
  const maxAttempts = data?.max_attempts ?? 5
  const retryDelay = data?.retry_delay_seconds ?? 60
  const priority = data?.priority ?? 0
  const nextRetryAt = new Date(Date.now() + retryDelay * 1000 * Math.pow(2, Math.min(attemptCount, 5)))

  const { error: updateError } = await supabaseAdmin
    .from(stagesTable)
    .update({
      status: attemptCount >= maxAttempts ? 'failed' : 'error',
      finished_at: finishedIso,
      last_error: error,
      next_retry_at: attemptCount < maxAttempts ? nextRetryAt.toISOString() : null,
    })
    .eq('job_id', jobId)
    .eq('stage', stage)

  if (updateError) {
    console.error(`Failed to record ${pipeline} stage failure`, stage, updateError)
  }

  await supabaseAdmin
    .from(jobsTable)
    .update({
      status: attemptCount >= maxAttempts ? 'failed' : 'error',
      last_failed_at: finishedIso,
    })
    .eq('id', jobId)

  if (pipeline === 'content') {
    const startedAt = data?.started_at ? new Date(data.started_at) : undefined
    const durationMs = startedAt ? finishedAt.getTime() - startedAt.getTime() : undefined
    const formattedError = formatError(error)

    console.log(
      JSON.stringify({
        type: 'stage_failed',
        pipeline,
        job_id: jobId,
        stage,
        attempt: attemptCount,
        max_attempts: maxAttempts,
        duration_ms: durationMs,
        priority,
        queue: context.queue,
        message_id: context.messageId,
        error: formattedError,
        timestamp: finishedIso,
      })
    )

    await recordMetric({
      jobId,
      stage,
      metricType: 'failure',
      value: 1,
      messageId: context.messageId,
      attempt: attemptCount,
      priority,
      metadata: buildMetricMetadata(
        {
          status: attemptCount >= maxAttempts ? 'failed' : 'error',
          error: formattedError,
          will_retry: attemptCount < maxAttempts,
        },
        { queue: context.queue }
      ),
    })

    if (durationMs !== undefined) {
      await recordMetric({
        jobId,
        stage,
        metricType: 'duration',
        value: durationMs,
        messageId: context.messageId,
        attempt: attemptCount,
        priority,
        metadata: buildMetricMetadata(
          { status: 'failed' },
          { queue: context.queue, started_at: data?.started_at, finished_at: finishedIso }
        ),
      })
    }
  }
}

export async function shouldDeadLetterForPipeline(
  pipeline: Pipeline,
  jobId: string,
  stage: string
): Promise<boolean> {
  const stagesTable = getStagesTable(pipeline)
  const { data } = await supabaseAdmin
    .from(stagesTable)
    .select('attempt_count, max_attempts')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  if (!data) return false

  return data.attempt_count >= data.max_attempts
}

// Legacy wrappers for the PlanPerfect pipeline
export async function startStage(jobId: string, stage: string, context: StageContext = {}): Promise<StageInfo> {
  return startStageForPipeline('content', jobId, stage, context)
}

export async function completeStage(jobId: string, stage: string, context: StageCompletionContext = {}) {
  return completeStageForPipeline('content', jobId, stage, context)
}

export async function failStage(jobId: string, stage: string, error: unknown, context: StageCompletionContext = {}) {
  return failStageForPipeline('content', jobId, stage, error, context)
}

export async function shouldDeadLetter(jobId: string, stage: string): Promise<boolean> {
  return shouldDeadLetterForPipeline('content', jobId, stage)
}
