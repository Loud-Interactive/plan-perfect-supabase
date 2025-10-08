// Supabase Edge Function: synopsis-status
// Description: Provides status and results for synopsis generation jobs

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

interface StatusResponse {
  success: boolean
  job_id: string
  domain: string
  status: string
  progress?: {
    total_pages: number
    completed_pages: number
    percentage: number
  }
  page_tasks?: any[]
  analysis_tasks?: any[]
  error_message?: string
  created_at?: string
  updated_at?: string
  completed_at?: string
  results?: any[]
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const jobId = url.pathname.split('/').pop()

    if (!jobId || jobId === 'synopsis-status') {
      return new Response(
        JSON.stringify({ error: 'Job ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`Getting status for job ${jobId}`)

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Job not found',
          job_id: jobId 
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const response: StatusResponse = {
      success: true,
      job_id: jobId,
      domain: job.domain,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
      error_message: job.error_message
    }

    // Add progress information
    if (job.total_pages > 0) {
      response.progress = {
        total_pages: job.total_pages,
        completed_pages: job.completed_pages || 0,
        percentage: Math.round(((job.completed_pages || 0) / job.total_pages) * 100)
      }
    }

    // If job is completed, get results from pairs table
    if (job.status === 'completed') {
      const { data: pairs, error: pairsError } = await supabase
        .from('pairs')
        .select('*')
        .eq('domain', job.domain)
        .eq('guid', job.guid)

      if (!pairsError && pairs) {
        response.results = pairs
      }
    }

    // Get page tasks for detailed status
    const { data: pageTasks, error: pageTasksError } = await supabase
      .from('synopsis_page_tasks')
      .select('id, url, title, category, importance, status, error_message, created_at, updated_at, completed_at')
      .eq('job_id', jobId)
      .order('importance', { ascending: false })

    if (!pageTasksError && pageTasks) {
      response.page_tasks = pageTasks
    }

    // Get analysis tasks for detailed status
    const { data: analysisTasks, error: analysisTasksError } = await supabase
      .from('synopsis_analysis_tasks')
      .select('id, analysis_type, status, error_message, created_at, updated_at, completed_at')
      .eq('job_id', jobId)
      .order('analysis_type')

    if (!analysisTasksError && analysisTasks) {
      response.analysis_tasks = analysisTasks
    }

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in synopsis-status:', error)
    
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

// Also handle the domain endpoint for compatibility with Python version
serve(async (req) => {
  const url = new URL(req.url)
  
  // Check if this is a domain request (e.g., /domain/example.com)
  if (url.pathname.startsWith('/domain/')) {
    const domain = url.pathname.replace('/domain/', '')
    const regenerate = url.searchParams.get('regenerate') === 'true'

    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'Domain is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    try {
      // Check for existing completed job or trigger new one
      const normalizedDomain = normalizeDomain(domain)
      
      if (!regenerate) {
        // Check for existing profile
        const { data: existingPairs, error: pairsError } = await supabase
          .from('pairs')
          .select('*')
          .eq('domain', normalizedDomain)
          .eq('key', 'has_profile')
          .eq('value', 'true')
          .maybeSingle()

        if (!pairsError && existingPairs) {
          // Get all pairs for the domain
          const { data: allPairs, error: allPairsError } = await supabase
            .from('pairs')
            .select('*')
            .eq('domain', normalizedDomain)

          if (!allPairsError && allPairs) {
            return new Response(
              JSON.stringify(allPairs),
              { 
                status: 200, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              }
            )
          }
        }
      }

      // Trigger new synopsis generation
      const orchestratorResponse = await fetch(`${supabaseUrl}/functions/v1/synopsis-orchestrator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          domain: domain,
          regenerate: regenerate
        })
      })

      const result = await orchestratorResponse.json()
      
      return new Response(
        JSON.stringify(result),
        { 
          status: orchestratorResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )

    } catch (error) {
      console.error('Error handling domain request:', error)
      
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
  }

  // If not a domain request, handle as regular status request
  return handleStatusRequest(req)
})

/**
 * Normalize domain name (same logic as other functions)
 */
function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

/**
 * Handle status request
 */
async function handleStatusRequest(req: Request): Promise<Response> {
  // This function would contain the main status logic
  // For now, just return the main status logic above
  return new Response(
    JSON.stringify({ error: 'Invalid request' }),
    { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
}