import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob } from '../_shared/queue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SchemaRequest {
  url?: string
  domain?: string
  requester_email?: string
  payload?: Record<string, unknown>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as SchemaRequest
    if (!body.url || !body.domain) {
      return new Response(JSON.stringify({ error: 'url and domain required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = { url: body.url, domain: body.domain, ...(body.payload ?? {}) }

    const { data, error } = await supabaseAdmin
      .from('content_jobs')
      .insert({
        job_type: 'schema',
        requester_email: body.requester_email,
        payload,
        status: 'queued',
        stage: 'schema-generation',
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('Failed to create schema job', error)
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jobId = data.id as string
    await insertEvent(jobId, 'queued', 'Schema job queued', payload)
    await enqueueJob('schema', jobId, 'schema-generation', payload)

    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Schema intake error', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
