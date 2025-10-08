import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob } from '../_shared/queue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface HtmlRequest {
  job_type?: 'html-regenerate' | 'html-index'
  guid?: string
  html_template_url?: string
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
    const body = (await req.json()) as HtmlRequest
    const jobType = body.job_type ?? 'html-regenerate'
    const payload = { guid: body.guid, html_template_url: body.html_template_url, ...(body.payload ?? {}) }

    const { data, error } = await supabaseAdmin
      .from('content_jobs')
      .insert({
        job_type: jobType,
        requester_email: body.requester_email,
        payload,
        status: 'queued',
        stage: 'distribution',
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('Failed to create html regen job', error)
      return new Response(JSON.stringify({ error: 'Failed to create job' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jobId = data.id as string
    await insertEvent(jobId, 'queued', `${jobType} job queued`, payload)
    await enqueueJob('content', jobId, 'distribution', payload)

    return new Response(JSON.stringify({ job_id: jobId }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('HTML regenerate intake error', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
