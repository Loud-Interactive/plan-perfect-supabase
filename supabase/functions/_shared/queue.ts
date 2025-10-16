import { supabaseAdmin, insertEvent } from './client.ts'

export interface QueueMessage<T = Record<string, unknown>> {
  msg_id: number
  message: {
    job_id: string
    stage: string
    payload: T
    priority?: number
    available_at?: string
    enqueued_at?: string
  }
}

export interface EnqueueOptions {
  priority?: number
  delaySeconds?: number
  visibilitySeconds?: number
  maxAttempts?: number
  retryDelaySeconds?: number
}

function normalizeEnqueueOptions(options?: number | EnqueueOptions): EnqueueOptions {
  if (typeof options === 'number') {
    return { delaySeconds: options }
  }
  return options ?? {}
}

export async function enqueueJob(
  queue: string,
  jobId: string,
  stage: string,
  payload: Record<string, unknown> = {},
  options?: number | EnqueueOptions
) {
  const normalized = normalizeEnqueueOptions(options)
  const { data, error } = await supabaseAdmin.rpc('enqueue_stage', {
    p_queue: queue,
    p_job_id: jobId,
    p_stage: stage,
    p_payload: payload,
    p_priority: normalized.priority ?? null,
    p_delay_seconds: normalized.delaySeconds ?? null,
    p_visibility_seconds: normalized.visibilitySeconds ?? null,
    p_max_attempts: normalized.maxAttempts ?? null,
    p_retry_delay_seconds: normalized.retryDelaySeconds ?? null,
  })

  if (error) {
    console.error('Failed to enqueue stage', error)
    await insertEvent(jobId, 'error', 'enqueue_stage_failed', { stage, error })
    throw error
  }

  await insertEvent(jobId, 'queued', `Enqueued stage ${stage}`, {
    queue,
    message_id: data,
    priority: normalized.priority ?? 0,
    delay_seconds: normalized.delaySeconds ?? 0,
  })

  return data as number
}

export async function dequeueNextJob(queue: string, visibilitySeconds = 600) {
  const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
    p_queue: queue,
    p_visibility_seconds: visibilitySeconds,
  })

  if (error) {
    console.error('Failed to dequeue message', error)
    throw error
  }

  const records = (data ?? []) as QueueMessage[]
  return records.length > 0 ? records[0] : null
}

export async function batchDequeueJobs(queue: string, visibilitySeconds = 600, batchSize = 10) {
  const { data, error } = await supabaseAdmin.rpc('dequeue_stage_batch', {
    p_queue: queue,
    p_visibility_seconds: visibilitySeconds,
    p_batch_size: batchSize,
  })
  if (error) {
    console.error('Failed to batch dequeue', error)
    throw error
  }
  return (data ?? []) as QueueMessage[]
}

export async function ackMessage(queue: string, msgId: number) {
  const { error } = await supabaseAdmin.rpc('archive_message', {
    p_queue: queue,
    p_msg_id: msgId,
  })
  if (error) {
    console.error('Failed to ack message', error)
    throw error
  }
}

export async function ackMessages(queue: string, msgIds: number[]) {
  if (msgIds.length === 0) return
  const { error } = await supabaseAdmin.rpc('archive_messages', {
    p_queue: queue,
    p_msg_ids: msgIds,
  })
  if (error) {
    console.error('Failed to ack messages', error)
    throw error
  }
}

export async function extendVisibility(
  queue: string,
  msgId: number,
  jobId: string,
  stage: string,
  additionalSeconds = 300
) {
  const { data, error } = await supabaseAdmin.rpc('extend_message_visibility', {
    p_queue: queue,
    p_msg_id: msgId,
    p_job_id: jobId,
    p_stage: stage,
    p_additional_seconds: additionalSeconds,
  })
  if (error) {
    console.error('Failed to extend visibility', error)
    throw error
  }
  return Boolean(data)
}

export async function delayedRequeueJob(
  queue: string,
  msgId: number,
  jobId: string,
  stage: string,
  payload: Record<string, unknown> = {},
  options?: { baseDelaySeconds?: number; priorityOverride?: number; visibilitySeconds?: number }
) {
  const { baseDelaySeconds, priorityOverride, visibilitySeconds } = options ?? {}
  const { data, error } = await supabaseAdmin.rpc('delayed_requeue_stage', {
    p_queue: queue,
    p_msg_id: msgId,
    p_job_id: jobId,
    p_stage: stage,
    p_payload: payload,
    p_base_delay_seconds: baseDelaySeconds ?? null,
    p_priority: priorityOverride ?? null,
    p_visibility_seconds: visibilitySeconds ?? null,
  })
  if (error) {
    console.error('Failed to delay requeue', error)
    await insertEvent(jobId, 'error', 'delayed_requeue_failed', { stage, error })
    throw error
  }
  await insertEvent(jobId, 'requeued', `Requeued stage ${stage}`, {
    queue,
    message_id: data,
    base_delay_seconds: baseDelaySeconds ?? null,
  })
  return data as number
}

export async function moveToDeadLetter(
  queue: string,
  msgId: number,
  jobId: string,
  stage: string,
  message: Record<string, unknown>,
  failureReason: string,
  errorDetails?: Record<string, unknown>,
  attemptCount = 0
) {
  const { data, error } = await supabaseAdmin.rpc('move_to_dead_letter', {
    p_queue: queue,
    p_msg_id: msgId,
    p_job_id: jobId,
    p_stage: stage,
    p_message: message,
    p_failure_reason: failureReason,
    p_error_details: errorDetails ?? null,
    p_attempt_count: attemptCount,
  })
  if (error) {
    console.error('Failed to move to dead letter', error)
    throw error
  }
  await insertEvent(jobId, 'dead_letter', `Moved to dead letter queue: ${failureReason}`, {
    stage,
    attempt_count: attemptCount,
    dlq_id: data,
  })
  return data as number
}

export async function getQueueDepth(queue: string) {
  const { data, error } = await supabaseAdmin.rpc('get_queue_depth', {
    p_queue: queue,
  })
  if (error) {
    console.error('Failed to get queue depth', error)
    throw error
  }
  return data as Record<string, unknown>
}
