// Supabase Edge Function: synopsis-orchestrator-fast
// Description: Fast-track synopsis workflow using Groq site summary fetch

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseKey)

interface OrchestrationRequest {
  domain: string
  regenerate?: boolean
}

interface OrchestrationResponse {
  success: boolean
  job_id: string
  message: string
  domain: string
  status: string
  guid: string | null
  cached?: boolean
  data?: any
}

interface ExistingProfileResult {
  guid: string | null
  pairs: any[]
}

const ACTIVE_JOB_STATUSES = [
  'pending',
  'processing',
  'discovering_pages',
  'ready_for_analysis',
  'analyzing',
  'finalizing'
]

const FAST_SOURCE = 'fast'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const { domain, regenerate = false }: OrchestrationRequest = await req.json()

    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'Domain is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const normalizedDomain = normalizeDomain(domain)
    console.log(`[synopsis-orchestrator-fast] Starting fast synopsis for ${normalizedDomain}`)

    if (!regenerate) {
      const existingProfile = await checkExistingProfile(normalizedDomain)
      if (existingProfile) {
        const metadataUpserted = await upsertDomainMetadata(normalizedDomain, {
          has_synopsis: true,
          synopsis_generation_guid: null,
          ...(existingProfile.guid ? { last_synopsis_guid: existingProfile.guid } : {})
        })

        if (!metadataUpserted) {
          console.warn(`[synopsis-orchestrator-fast] Failed to upsert domains row for cached profile ${normalizedDomain}`)
        }

        return new Response(
          JSON.stringify({
            success: true,
            job_id: 'cached',
            message: 'Using existing profile',
            domain: normalizedDomain,
            status: 'completed',
            cached: true,
            guid: existingProfile.guid,
            data: existingProfile.pairs
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      const activeJob = await findActiveJobForDomain(normalizedDomain)
      if (activeJob) {
        const jobGuid = await ensureJobGuid(activeJob.id, activeJob.guid)
        const upserted = await upsertDomainMetadata(
          normalizedDomain,
          jobGuid
            ? {
                last_synopsis_guid: jobGuid,
                synopsis_generation_guid: jobGuid
              }
            : {}
        )
        if (!upserted) {
          console.warn(`[synopsis-orchestrator-fast] Failed to upsert domains row when reusing job ${activeJob.id}`)
        }

        const reuseResponse: OrchestrationResponse = {
          success: true,
          job_id: activeJob.id,
          message: 'Existing fast synopsis job in progress',
          domain: normalizedDomain,
          status: activeJob.status || 'processing',
          guid: jobGuid
        }

        return new Response(
          JSON.stringify(reuseResponse),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }
    }

    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .insert({
        domain: normalizedDomain,
        status: 'processing',
        regenerate,
        total_pages: 0,
        completed_pages: 0,
        source: FAST_SOURCE
      })
      .select()
      .single()

    if (jobError || !job) {
      console.error('[synopsis-orchestrator-fast] Error creating synopsis job:', jobError)
      throw new Error(`Failed to create job: ${jobError?.message ?? 'unknown error'}`)
    }

    const jobGuid = await ensureJobGuid(job.id, job.guid)
    const metadataUpserted = await upsertDomainMetadata(
      normalizedDomain,
      jobGuid
        ? {
            last_synopsis_guid: jobGuid,
            synopsis_generation_guid: jobGuid
          }
        : {}
    )
    if (!metadataUpserted) {
      console.warn(`[synopsis-orchestrator-fast] Failed to upsert domains row for new job ${job.id}`)
    }

    triggerFastCrawler(job.id, normalizedDomain).catch((error) => {
      console.error(`[synopsis-orchestrator-fast] Failed to trigger fast crawler for ${job.id}:`, error)
    })

    const response: OrchestrationResponse = {
      success: true,
      job_id: job.id,
      message: 'Fast synopsis generation started',
      domain: normalizedDomain,
      status: 'processing',
      guid: jobGuid
    }

    return new Response(
      JSON.stringify(response),
      {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('[synopsis-orchestrator-fast] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

async function checkExistingProfile(domain: string): Promise<ExistingProfileResult | null> {
  try {
    const { data: hasProfileData, error: hasProfileError } = await supabase
      .from('pairs')
      .select('value')
      .eq('domain', domain)
      .eq('key', 'has_profile')
      .single()

    if (hasProfileError || !hasProfileData || hasProfileData.value !== 'true') {
      return null
    }

    const { data: allPairs, error: pairsError } = await supabase
      .from('pairs')
      .select('*')
      .eq('domain', domain)

    if (pairsError || !allPairs || allPairs.length === 0) {
      return null
    }

    return {
      guid: allPairs[0]?.guid ?? null,
      pairs: allPairs
    }
  } catch (error) {
    console.error('[synopsis-orchestrator-fast] Error checking existing profile:', error)
    return null
  }
}

async function findActiveJobForDomain(domain: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .eq('domain', domain)
      .eq('source', FAST_SOURCE)
      .in('status', ACTIVE_JOB_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) {
      return null
    }

    return data[0]
  } catch (error) {
    console.error('[synopsis-orchestrator-fast] Error finding active job:', error)
    return null
  }
}

async function ensureJobGuid(jobId: string, currentGuid?: string | null): Promise<string | null> {
  if (currentGuid) {
    return currentGuid
  }

  if (typeof crypto?.randomUUID !== 'function') {
    console.error('[synopsis-orchestrator-fast] crypto.randomUUID unavailable; cannot assign job guid')
    return null
  }

  const newGuid = crypto.randomUUID()

  const { error } = await supabase
    .from('synopsis_jobs')
    .update({ guid: newGuid })
    .eq('id', jobId)

  if (error) {
    console.error('[synopsis-orchestrator-fast] Error assigning job guid:', error)
    return null
  }

  return newGuid
}

async function upsertDomainMetadata(domain: string, fields: Record<string, any>): Promise<boolean> {
  const timestamp = new Date().toISOString()
  const payload = { domain, updated_date: timestamp, ...fields }

  try {
    const { data, error } = await supabase
      .from('domains')
      .upsert(payload, { onConflict: 'domain' })
      .select('domain')

    if (error) {
      if (fields.last_synopsis_guid !== undefined && typeof error.message === 'string' && error.message.includes('last_synopsis_guid')) {
        console.warn('[synopsis-orchestrator-fast] domains.last_synopsis_guid column missing. Retrying without guid field.')
        const { last_synopsis_guid, ...rest } = fields
        const fallbackPayload = { domain, updated_date: timestamp, ...rest }
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('domains')
          .upsert(fallbackPayload, { onConflict: 'domain' })
          .select('domain')

        if (fallbackError) {
          throw fallbackError
        }

        return !!(fallbackData && fallbackData.length > 0)
      }

      if (fields.synopsis_generation_guid !== undefined && typeof error.message === 'string' && error.message.includes('synopsis_generation_guid')) {
        console.warn('[synopsis-orchestrator-fast] domains.synopsis_generation_guid column missing. Retrying without generation guid field.')
        const { synopsis_generation_guid, ...rest } = fields
        const fallbackPayload = { domain, updated_date: timestamp, ...rest }
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('domains')
          .upsert(fallbackPayload, { onConflict: 'domain' })
          .select('domain')

        if (fallbackError) {
          throw fallbackError
        }

        return !!(fallbackData && fallbackData.length > 0)
      }

      throw error
    }

    return !!(data && data.length > 0)
  } catch (error) {
    console.error('[synopsis-orchestrator-fast] Error upserting domains metadata:', error)
    return false
  }
}

async function triggerFastCrawler(jobId: string, domain: string): Promise<void> {
  try {
    const payload = { job_id: jobId, domain }
    await fetch(`${supabaseUrl}/functions/v1/synopsis-crawler-fast`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    console.error('[synopsis-orchestrator-fast] Error triggering fast crawler:', error)
  }
}
