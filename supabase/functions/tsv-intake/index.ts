import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEvent } from '../_shared/client.ts'
import { enqueueJob } from '../_shared/queue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RowPayload {
  [key: string]: unknown
}

interface RequestBody {
  rows?: RowPayload[]
  requester_email?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as RequestBody
    const rows = body.rows ?? []
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: 'rows array required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const createdJobs: string[] = []
    for (const row of rows) {
      const { data, error } = await supabaseAdmin
        .from('content_jobs')
        .insert({
          job_type: 'tsv',
          requester_email: body.requester_email,
          payload: row,
          status: 'queued',
          stage: 'research',
        })
        .select('id')
        .single()

      if (error || !data) {
        console.error('Failed to create TSV job', error)
        continue
      }

      const jobId = data.id as string
      createdJobs.push(jobId)
      await insertEvent(jobId, 'queued', 'TSV row queued', { row })
      await enqueueJob('tsv', jobId, 'research', row)
    }

    return new Response(JSON.stringify({ count: createdJobs.length, job_ids: createdJobs }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('TSV intake error', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
