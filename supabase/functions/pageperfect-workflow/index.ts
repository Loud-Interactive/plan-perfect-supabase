// PagePerfect Workflow Intake: validates input, creates job, and enqueues first stage
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin, insertEventForPipeline } from '../_shared/client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface IntakeRequest {
  url?: string
  pageId?: string
  skipSteps?: string[]
  forceUpdate?: boolean
  openaiApiKey?: string
  premium?: boolean
  ultraPremium?: boolean
  render?: boolean
  timeout?: number
  priority?: number
  maxAttempts?: number
  retryDelaySeconds?: number
  requesterEmail?: string
}

async function resolvePage(url?: string, pageId?: string) {
  if (!url && !pageId) {
    throw new Error('Either url or pageId is required')
  }

  if (pageId) {
    const { data, error } = await supabaseAdmin
      .from('pages')
      .select('id, url')
      .eq('id', pageId)
      .maybeSingle()

    if (error || !data) {
      throw new Error(`Page not found: ${error?.message ?? 'No data returned'}`)
    }

    return { pageId: data.id, url: data.url }
  }

  if (!url) {
    throw new Error('URL is required when pageId is not provided')
  }

  const { data, error } = await supabaseAdmin
    .from('pages')
    .select('id, url')
    .eq('url', url)
    .maybeSingle()

  if (error) {
    throw new Error(`Error checking for existing page: ${error.message}`)
  }

  if (data) {
    return { pageId: data.id, url: data.url }
  }

  const { data: newPage, error: createError } = await supabaseAdmin
    .from('pages')
    .insert({ url })
    .select('id, url')
    .single()

  if (createError || !newPage) {
    throw new Error(`Error creating page: ${createError?.message ?? 'No data returned'}`)
  }

  return { pageId: newPage.id, url: newPage.url }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const body = (await req.json()) as IntakeRequest

    const { pageId, url } = await resolvePage(body.url, body.pageId)

    const payload = {
      url,
      page_id: pageId,
      skip_steps: body.skipSteps ?? [],
      force_update: body.forceUpdate ?? false,
      openai_api_key: body.openaiApiKey ?? Deno.env.get('OPENAI_API_KEY'),
      premium: body.premium ?? false,
      ultra_premium: body.ultraPremium ?? false,
      render: body.render ?? true,
      timeout: body.timeout ?? 60000,
    }

    const priority = body.priority ?? 0
    const maxAttempts = body.maxAttempts ?? 5
    const retryDelaySeconds = body.retryDelaySeconds ?? 60

    const { data: jobId, error: createError } = await supabaseAdmin.rpc('create_pageperfect_job', {
      p_url: url,
      p_page_id: pageId,
      p_payload: payload,
      p_initial_stage: 'submit_crawl',
      p_priority: priority,
      p_max_attempts: maxAttempts,
      p_retry_delay_seconds: retryDelaySeconds,
      p_requester_email: body.requesterEmail ?? null,
    })

    if (createError || !jobId) {
      console.error('Failed to create PagePerfect job', createError)
      return new Response(
        JSON.stringify({ error: 'Failed to create job', details: createError?.message ?? createError }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    await insertEventForPipeline('pageperfect', jobId as string, 'queued', 'PagePerfect job queued by intake', {
      payload_keys: Object.keys(payload),
      priority,
      max_attempts: maxAttempts,
      retry_delay_seconds: retryDelaySeconds,
    })

    console.log(`PagePerfect job ${jobId} created for URL ${url}`)

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        page_id: pageId,
        url,
        status: 'queued',
        stage: 'submit_crawl',
      }),
      {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('PagePerfect intake error', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
