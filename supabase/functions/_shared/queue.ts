import { supabaseAdmin, insertEvent } from './client.ts'

export async function enqueueJob(queue: string, jobId: string, stage: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabaseAdmin.rpc('enqueue_stage', {
    p_queue: queue,
    p_job_id: jobId,
    p_stage: stage,
    p_payload: payload,
  })
  if (error) {
    console.error('Failed to enqueue stage', error)
    await insertEvent(jobId, 'error', 'enqueue_stage_failed', { stage, error })
    throw error
  }
  await insertEvent(jobId, 'queued', `Enqueued stage ${stage}`, { queue, message_id: data })
  return data as number
}
