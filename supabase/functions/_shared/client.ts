import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.')
}

export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
})

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export interface MetricPayload {
  jobId?: string
  stage: string
  metricType: string
  value: number
  messageId?: number
  attempt?: number
  priority?: number
  metadata?: Record<string, unknown>
}

export async function recordMetric({
  jobId,
  stage,
  metricType,
  value,
  messageId,
  attempt,
  priority,
  metadata,
}: MetricPayload) {
  if (!stage || !metricType) {
    return
  }

  const { error } = await supabaseAdmin.rpc('record_job_metric', {
    p_job_id: jobId ?? null,
    p_stage: stage,
    p_metric_type: metricType,
    p_metric_value: value,
    p_message_id: messageId ?? null,
    p_attempt_count: attempt ?? null,
    p_priority: priority ?? null,
    p_metadata: metadata ?? {},
  })

  if (error) {
    console.error('Failed to record metric', { jobId, stage, metricType, value }, error)
  }
}

export async function insertEvent(jobId: string, status: string, message: string, metadata: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString()
  const stage = typeof metadata.stage === 'string' ? metadata.stage : undefined
  const attempt = toNumber((metadata as Record<string, unknown>)?.attempt ?? (metadata as Record<string, unknown>)?.attempt_count)
  const messageId = toNumber((metadata as Record<string, unknown>)?.message_id ?? (metadata as Record<string, unknown>)?.msg_id)
  const latencyMs = toNumber((metadata as Record<string, unknown>)?.latency_ms ?? (metadata as Record<string, unknown>)?.latency)
  const priority = toNumber((metadata as Record<string, unknown>)?.priority)
  const queue = typeof (metadata as Record<string, unknown>)?.queue === 'string' ? String((metadata as Record<string, unknown>).queue) : undefined

  const logPayload = {
    type: 'job_event',
    job_id: jobId,
    stage,
    status,
    message,
    attempt,
    message_id: messageId,
    latency_ms: latencyMs,
    priority,
    queue,
    timestamp,
  }

  console.log(JSON.stringify({ ...logPayload, metadata }))

  const { error } = await supabaseAdmin.from('content_job_events').insert({
    job_id: jobId,
    stage,
    status,
    message,
    metadata,
  })

  if (error) {
    console.error('Failed to insert job event', error)
  }

  if (stage && (status === 'error' || status === 'failed')) {
    await recordMetric({
      jobId,
      stage,
      metricType: 'failure',
      value: 1,
      messageId,
      attempt,
      priority,
      metadata: {
        status,
        message,
        latency_ms: latencyMs,
        queue,
      },
    })
  }
}
