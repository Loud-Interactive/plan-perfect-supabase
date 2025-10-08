import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob } from '../_shared/queue.ts'
import { runBackground, registerBeforeUnload } from '../_shared/runtime.ts'
import { startStage, completeStage, failStage } from '../_shared/stages.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

registerBeforeUnload(() => console.log('content-draft-worker terminating'))

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const visibility = Number(Deno.env.get('CONTENT_QUEUE_VISIBILITY') ?? '600')
  const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
    p_queue: 'content',
    p_visibility: visibility,
  })
  if (error) {
    console.error('Failed to pop draft message', error)
    return new Response(JSON.stringify({ error: 'queue_pop_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!data || data.length === 0) {
    return new Response(JSON.stringify({ message: 'no messages' }), {
      status: 204,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const record = data[0] as { msg_id: number; message: { job_id: string; stage?: string; payload?: Record<string, unknown> } }
  const { msg_id, message } = record
  const jobId = message?.job_id
  const stage = message?.stage ?? 'draft'
  const payload = message?.payload ?? {}

  if (!jobId) {
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: 'invalid message archived' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (stage !== 'draft') {
    await enqueueJob('content', jobId, stage, payload)
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: `forwarded stage ${stage}` }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await insertEvent(jobId, 'processing', 'Draft stage started', payload)
  const attempt = await startStage(jobId, 'draft')
  const maxAttempts = Number(Deno.env.get('CONTENT_STAGE_MAX_ATTEMPTS') ?? '3')

  const subsection = (payload?.subsection_idx as number | undefined) ?? 0

  const work = (async () => {
    // Placeholder: generate simple markdown stub per subsection
    const draftSnippet = `# Draft subsection ${subsection}\n\nThis is placeholder content generated during migration.`

    try {
      const { data: existing } = await supabaseAdmin
        .from('content_payloads')
        .select('data')
        .eq('job_id', jobId)
        .eq('stage', 'draft')
        .maybeSingle()

      const combined = existing?.data ?? { sections: [] as string[] }
      combined.sections = Array.isArray(combined.sections) ? combined.sections : []
      combined.sections[subsection] = draftSnippet

      const { error: upsertError } = await supabaseAdmin
        .from('content_payloads')
        .upsert({ job_id: jobId, stage: 'draft', data: combined })

      if (upsertError) {
        throw upsertError
      }

      const nextSubsection = subsection + 1
      const remaining = (payload?.total_sections as number | undefined) ?? combined.sections.length

      if (nextSubsection < remaining) {
        await enqueueJob('content', jobId, 'draft', {
          subsection_idx: nextSubsection,
          total_sections: remaining,
        })
      } else {
        await completeStage(jobId, 'draft')
        await supabaseAdmin
          .from('content_jobs')
          .update({ stage: 'qa', status: 'queued' })
          .eq('id', jobId)
        await enqueueJob('content', jobId, 'qa', {})
        await insertEvent(jobId, 'completed', 'Draft stage completed')
      }

      await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    } catch (workerError) {
      console.error('Draft worker failure', workerError)
      await insertEvent(jobId, 'error', 'Draft stage failed', { error: workerError })
      await failStage(jobId, 'draft', workerError)
      if (attempt < maxAttempts) {
        await enqueueJob('content', jobId, 'draft', {
          subsection_idx: subsection,
          total_sections: payload?.total_sections ?? 1,
        })
      }
      await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    }
  })()

  runBackground(work)

  return new Response(JSON.stringify({ message: 'draft stage scheduled', job_id: jobId, subsection }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
