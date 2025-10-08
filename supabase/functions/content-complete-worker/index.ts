import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { startStage, completeStage } from '../_shared/stages.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const { data, error } = await supabaseAdmin.rpc('dequeue_stage', {
    p_queue: 'content',
    p_visibility: 60,
  })
  if (error) {
    console.error('Failed to pop completion message', error)
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

  const record = data[0] as { msg_id: number; message: { job_id: string; stage?: string } }
  const { msg_id, message } = record
  const jobId = message?.job_id
  const stage = message?.stage ?? 'complete'

  if (!jobId || stage !== 'complete') {
    await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })
    return new Response(JSON.stringify({ message: 'archived non-complete stage' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await startStage(jobId, 'complete')
  await completeStage(jobId, 'complete')
  await insertEvent(jobId, 'completed', 'Job fully completed')
  await supabaseAdmin.rpc('archive_message', { p_queue: 'content', p_msg_id: msg_id })

  return new Response(JSON.stringify({ message: 'job archived', job_id: jobId }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
