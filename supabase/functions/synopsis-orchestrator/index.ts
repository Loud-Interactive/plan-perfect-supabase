// Supabase Edge Function: synopsis-orchestrator
// Description: Main entry point for Synopsis Perfect Redux system
// Orchestrates the complete synopsis generation workflow

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Initialize Supabase client
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

serve(async (req) => {
  // Handle CORS
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

    // Normalize domain (same logic as Python version)
    const normalizedDomain = normalizeDomain(domain)
    console.log(`Starting synopsis generation for domain: ${normalizedDomain}`)

    // Check if we already have a profile and regenerate is false
    if (!regenerate) {
      const existingProfile = await checkExistingProfile(normalizedDomain)
      if (existingProfile) {
        console.log(`Found existing profile for ${normalizedDomain}, returning cached results`)

        const cachedUpserted = await upsertDomainMetadata(normalizedDomain, {
          has_synopsis: true,
          synopsis_generation_guid: null,
          ...(existingProfile.guid ? { last_synopsis_guid: existingProfile.guid } : {})
        })

        if (!cachedUpserted) {
          console.warn(`[synopsis-orchestrator] Failed to upsert domains row for cached profile ${normalizedDomain}`)
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

      const resumableJob = await findActiveJobForDomain(normalizedDomain)
      if (resumableJob) {
        console.log(`Found active synopsis job ${resumableJob.id} for ${normalizedDomain}. Reusing existing job.`)

        const jobGuid = await ensureJobGuid(resumableJob.id, resumableJob.guid)

        const reusedUpserted = await upsertDomainMetadata(
          normalizedDomain,
          jobGuid
            ? {
                last_synopsis_guid: jobGuid,
                synopsis_generation_guid: jobGuid
              }
            : {}
        )

        if (!reusedUpserted) {
          console.warn(`[synopsis-orchestrator] Failed to upsert domains row when reusing job ${resumableJob.id}`)
        }

        const response: OrchestrationResponse = {
          success: true,
          job_id: resumableJob.id,
          message: 'Existing synopsis job in progress',
          domain: normalizedDomain,
          status: resumableJob.status || 'processing',
          guid: jobGuid
        }

        return new Response(
          JSON.stringify(response),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }
    }

    // Get final URL (handle redirects)
    const finalUrl = await getFinalUrl(domain)
    console.log(`Final URL after redirects: ${finalUrl}`)

    // Create new synopsis job
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .insert({
        domain: normalizedDomain,
        status: 'pending',
        regenerate: regenerate,
        total_pages: 0,
        completed_pages: 0
      })
      .select()
      .single()

    if (jobError) {
      console.error('Error creating synopsis job:', jobError)
      throw new Error(`Failed to create job: ${jobError.message}`)
    }

    const jobGuid = await ensureJobGuid(job.id, job.guid)

    console.log(`Created synopsis job: ${job.id} (guid: ${jobGuid})`)

    // Trigger page discovery process
    await triggerPageDiscovery(job.id, finalUrl)

    // Return job details
    const response: OrchestrationResponse = {
      success: true,
      job_id: job.id,
      message: 'Synopsis generation started',
      domain: normalizedDomain,
      status: 'processing',
      guid: jobGuid
    }

    const insertedDomain = await upsertDomainMetadata(
      normalizedDomain,
      jobGuid
        ? {
            last_synopsis_guid: jobGuid,
            synopsis_generation_guid: jobGuid
          }
        : {}
    )

    if (!insertedDomain) {
      console.warn(`[synopsis-orchestrator] Failed to upsert domains row for new job ${job.id}`)
    }

    return new Response(
      JSON.stringify(response),
      { 
        status: 202, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in synopsis-orchestrator:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/**
 * Normalize domain name (same logic as Python version)
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

/**
 * Check if domain already has a complete profile
 */
async function checkExistingProfile(domain: string): Promise<ExistingProfileResult | null> {
  try {
    // Check for has_profile flag
    const { data: hasProfileData, error: hasProfileError } = await supabase
      .from('pairs')
      .select('value')
      .eq('domain', domain)
      .eq('key', 'has_profile')
      .single()

    if (hasProfileError || !hasProfileData || hasProfileData.value !== 'true') {
      return null
    }

    // Get all pairs for the domain
    const { data: allPairs, error: pairsError } = await supabase
      .from('pairs')
      .select('*')
      .eq('domain', domain)

    if (pairsError) {
      console.error('Error fetching existing pairs:', pairsError)
      return null
    }

    if (!allPairs || allPairs.length === 0) {
      return null
    }

    const guid = allPairs[0]?.guid ?? null

    return {
      guid,
      pairs: allPairs
    }
  } catch (error) {
    console.error('Error checking existing profile:', error)
    return null
  }
}

async function findActiveJobForDomain(domain: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .eq('domain', domain)
      .in('status', ACTIVE_JOB_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      console.error('Error looking up existing job:', error)
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    return data[0]
  } catch (error) {
    console.error('Error finding active job:', error)
    return null
  }
}

async function ensureJobGuid(jobId: string, currentGuid?: string | null): Promise<string> {
  if (currentGuid) {
    return currentGuid
  }

  if (typeof crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID unavailable; cannot assign job guid')
  }

  const newGuid = crypto.randomUUID()

  const { error } = await supabase
    .from('synopsis_jobs')
    .update({ guid: newGuid })
    .eq('id', jobId)

  if (error) {
    console.error('Error assigning synopsis job guid:', error)
    throw new Error('Failed to assign job guid')
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
        console.warn('[synopsis-orchestrator] domains.last_synopsis_guid column missing. Retrying upsert without the guid field.')
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
        console.warn('[synopsis-orchestrator] domains.synopsis_generation_guid column missing. Retrying without the generation guid field.')
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
    console.error('Error upserting domains metadata:', error)
    return false
  }
}

/**
 * Get final URL after following redirects (same logic as Python version)
 */
async function getFinalUrl(rootDomain: string): Promise<string> {
  let url = rootDomain
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }

  try {
    const response = await fetch(url, { 
      method: 'GET',
      redirect: 'follow'
    })
    return response.url
  } catch (error) {
    console.error('Error getting final URL:', error)
    return url
  }
}

/**
 * Trigger the page discovery process
 */
async function triggerPageDiscovery(jobId: string, finalUrl: string): Promise<void> {
  try {
    // Call the page discovery function
    const discoveryResponse = await fetch(`${supabaseUrl}/functions/v1/synopsis-page-discovery`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId,
        domain_url: finalUrl
      })
    })

    if (!discoveryResponse.ok) {
      const errorText = await discoveryResponse.text()
      throw new Error(`Page discovery failed: ${errorText}`)
    }

    console.log(`Successfully triggered page discovery for job ${jobId}`)
  } catch (error) {
    console.error('Error triggering page discovery:', error)
    
    // Update job status to failed
    await supabase
      .from('synopsis_jobs')
      .update({
        status: 'failed',
        error_message: `Page discovery trigger failed: ${error.message}`
      })
      .eq('id', jobId)
    
    throw error
  }
}
