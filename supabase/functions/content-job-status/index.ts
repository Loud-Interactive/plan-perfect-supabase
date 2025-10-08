import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin } from '../_shared/client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const jobId = url.searchParams.get('job_id')
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'job_id query param required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: job, error } = await supabaseAdmin
    .from('content_jobs')
    .select('id, job_type, status, stage, created_at, updated_at, result, error')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: events } = await supabaseAdmin
    .from('content_job_events')
    .select('created_at, status, message, metadata')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })

  return new Response(
    JSON.stringify({ job, events: events ?? [] }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
