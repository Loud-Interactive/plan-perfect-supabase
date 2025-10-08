import { supabaseAdmin } from './client.ts'

export async function startStage(jobId: string, stage: string) {
  const { data, error } = await supabaseAdmin
    .from('content_job_stages')
    .select('attempt')
    .eq('job_id', jobId)
    .eq('stage', stage)
    .maybeSingle()

  const nextAttempt = (data?.attempt ?? 0) + 1

  const { error: upsertError } = await supabaseAdmin
    .from('content_job_stages')
    .upsert({
      job_id: jobId,
      stage,
      status: 'processing',
      attempt: nextAttempt,
      started_at: new Date().toISOString(),
      finished_at: null,
    })

  if (error || upsertError) {
    console.error('Failed to start stage', stage, error ?? upsertError)
  }
  return nextAttempt
}

export async function completeStage(jobId: string, stage: string) {
  const finishedAt = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('content_job_stages')
    .upsert({
      job_id: jobId,
      stage,
      status: 'completed',
      finished_at: finishedAt,
    })
  if (error) {
    console.error('Failed to mark stage complete', stage, error)
  }
}

export async function failStage(jobId: string, stage: string, error: unknown) {
  const { error: updateError } = await supabaseAdmin
    .from('content_job_stages')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      last_error: error,
    })
    .eq('job_id', jobId)
    .eq('stage', stage)

  if (updateError) {
    console.error('Failed to record stage failure', stage, updateError)
  }
}
