import { supabaseAdmin } from './client.ts'

export interface StageInfo {
  attempt_count: number
  max_attempts: number
  retry_delay_seconds: number
  priority: number
  status: string
  dead_lettered_at?: string
}

export async function startStage(jobId: string, stage: string): Promise<StageInfo> {
  const { data, error } = await supabaseAdmin
    .from('content_job_stages')
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
    .from('content_job_stages')
    .upsert({
      job_id: jobId,
      stage,
      status: 'processing',
      attempt_count: nextAttempt,
      max_attempts: maxAttempts,
      retry_delay_seconds: retryDelay,
      priority,
      started_at: new Date().toISOString(),
      finished_at: null,
      last_error: null,
    })

  if (error || upsertError) {
    console.error('Failed to start stage', stage, error ?? upsertError)
  }

  return {
    attempt_count: nextAttempt,
    max_attempts: maxAttempts,
    retry_delay_seconds: retryDelay,
    priority,
    status: 'processing',
  }
}

export async function completeStage(jobId: string, stage: string) {
  const finishedAt = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('content_job_stages')
    .update({
      status: 'completed',
      finished_at: finishedAt,
      next_retry_at: null,
      last_error: null,
    })
    .eq('job_id', jobId)
    .eq('stage', stage)

  if (error) {
    console.error('Failed to mark stage complete', stage, error)
  }

  await supabaseAdmin
    .from('content_jobs')
    .update({
      status: 'processing',
      last_completed_at: finishedAt,
    })
    .eq('id', jobId)
}

export async function failStage(jobId: string, stage: string, error: unknown) {
  const finishedAt = new Date().toISOString()
  const { data } = await supabaseAdmin
    .from('content_job_stages')
    .select('attempt_count, max_attempts, retry_delay_seconds')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  const attemptCount = data?.attempt_count ?? 1
  const maxAttempts = data?.max_attempts ?? 5
  const retryDelay = data?.retry_delay_seconds ?? 60
  const nextRetryAt = new Date(Date.now() + retryDelay * 1000 * Math.pow(2, Math.min(attemptCount, 5)))

  const { error: updateError } = await supabaseAdmin
    .from('content_job_stages')
    .update({
      status: attemptCount >= maxAttempts ? 'failed' : 'error',
      finished_at: finishedAt,
      last_error: error,
      next_retry_at: attemptCount < maxAttempts ? nextRetryAt.toISOString() : null,
    })
    .eq('job_id', jobId)
    .eq('stage', stage)

  if (updateError) {
    console.error('Failed to record stage failure', stage, updateError)
  }

  await supabaseAdmin
    .from('content_jobs')
    .update({
      status: attemptCount >= maxAttempts ? 'failed' : 'error',
      last_failed_at: finishedAt,
    })
    .eq('id', jobId)
}

export async function shouldDeadLetter(jobId: string, stage: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('content_job_stages')
    .select('attempt_count, max_attempts')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  if (!data) return false

  return data.attempt_count >= data.max_attempts
}
