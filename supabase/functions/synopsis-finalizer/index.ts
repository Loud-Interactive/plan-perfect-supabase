// Supabase Edge Function: synopsis-finalizer
// Description: Finalizes synopsis generation by combining results and storing in pairs table

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { callModelWithLogging } from "../utils/model-logging.ts"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Log current model being used
const SYNOPSIS_MODEL = Deno.env.get('SYNOPSIS_MODEL') || 'deepseek'
console.log(`[synopsis-finalizer] Using model: ${SYNOPSIS_MODEL}`)

interface FinalizerRequest {
  job_id: string
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Store the job_id early to use in error handling
  let jobId: string | null = null
  
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

    const requestData: FinalizerRequest = await req.json()
    jobId = requestData.job_id

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log(`Starting finalization for job ${jobId}`)

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('synopsis_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    // Get all completed analysis tasks
    const { data: analysisTasks, error: tasksError } = await supabase
      .from('synopsis_analysis_tasks')
      .select('*')
      .eq('job_id', jobId)
      .eq('status', 'completed')

    if (tasksError) {
      throw new Error(`Failed to get analysis tasks: ${tasksError.message}`)
    }

    if (!analysisTasks || analysisTasks.length === 0) {
      console.warn(`No completed analysis tasks found for job ${jobId}`)
      
      // Check if there are any pending or failed tasks
      const { data: allTasks, error: allTasksError } = await supabase
        .from('synopsis_analysis_tasks')
        .select('status, count(*)')
        .eq('job_id', jobId)
        .groupBy('status')
      
      if (allTasks && allTasks.length > 0) {
        console.log('Task status breakdown:', allTasks)
        
        // If there are pending tasks, return a more informative error
        const pendingCount = allTasks.find(t => t.status === 'pending')?.count || 0
        const failedCount = allTasks.find(t => t.status === 'failed')?.count || 0
        
        if (pendingCount > 0) {
          throw new Error(`Still have ${pendingCount} pending analysis tasks. Finalizer called too early.`)
        } else if (failedCount > 0) {
          console.warn(`All ${failedCount} analysis tasks failed. Proceeding with partial completion.`)
          // Continue with partial completion instead of failing
        }
      } else {
        throw new Error('No analysis tasks found at all for this job')
      }
    }

    console.log(`Found ${analysisTasks?.length || 0} completed analysis tasks`)

    // Process each analysis result and store in pairs table (same logic as Python version)
    const guid = job.guid
    const domain = job.domain

    const aggregatedPairs: Record<string, string> = {}

    if (analysisTasks && analysisTasks.length > 0) {
      for (const task of analysisTasks) {
        const pairs = await processAnalysisResult(task)
        Object.assign(aggregatedPairs, pairs)
      }
    }

    // Generate brand document even with partial data
    await generateBrandDocument(domain, guid)

    if (Object.keys(aggregatedPairs).length > 0) {
      await upsertPairsBulk(domain, guid, aggregatedPairs)
    }

    // Mark job as completed (or partially completed)
    const completionStatus = analysisTasks && analysisTasks.length > 0 ? 'completed' : 'partial'
    await supabase
      .from('synopsis_jobs')
      .update({
        status: completionStatus,
        completed_at: new Date().toISOString(),
        partial_status: completionStatus === 'partial' ? 'minimal' : 'complete'
      })
      .eq('id', jobId)

    // Set has_profile flag (same as Python version)
    await setHasProfileFlag(domain, guid)

    if (completionStatus === 'completed') {
      await markDomainHasSynopsis(domain, guid)
    }

    console.log(`Successfully ${completionStatus} synopsis generation for domain: ${domain}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synopsis generation ${completionStatus}`,
        job_id: jobId,
        domain: domain,
        guid: guid,
        analysis_tasks_processed: analysisTasks?.length || 0,
        completion_status: completionStatus
        , pairs_upserted: aggregatedPairs
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in synopsis-finalizer:', error)
    
    // Update job status to failed using the stored jobId
    if (jobId) {
      await supabase
        .from('synopsis_jobs')
        .update({
          status: 'failed',
          error_message: `Finalization failed: ${error.message}`
        })
        .eq('id', jobId)
    }
    
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
 * Process analysis result and store in pairs table (same logic as Python version)
 */
async function processAnalysisResult(task: any): Promise<Record<string, string>> {
  try {
    if (!task.llm_response) {
      console.log(`Skipping task ${task.analysis_type} - no LLM response`)
      return {}
    }

    // Extract JSON from response (same logic as Python version)
    const jsonData = extractJsonFromResponse(task.llm_response)
    
    if (!jsonData || Object.keys(jsonData).length === 0) {
      console.log(`Skipping task ${task.analysis_type} - no valid JSON data`)
      return {}
    }

    const keyValuePairs = convertToKeyValuePairs(jsonData)
    console.log(`Processed ${Object.keys(keyValuePairs).length} pairs for ${task.analysis_type}`)
    return keyValuePairs

  } catch (error) {
    console.error(`Error processing analysis result for ${task.analysis_type}:`, error)
    // Don't throw - continue with other tasks
    return {}
  }
}

/**
 * Extract JSON from LLM response (same logic as Python version)
 */
function extractJsonFromResponse(response: string): any {
  try {
    // First try to parse as-is
    return JSON.parse(response)
  } catch {
    try {
      // Extract content between markers (same as Python version)
      const codeBlockMatch = response.match(/```(?:json|javascript|js)?\s*([\s\S]*?)\s*```/)
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1])
      }

      // Look for JSON object in response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }

      console.error('No valid JSON found in response:', response)
      return {}
    } catch (error) {
      console.error('Error extracting JSON:', error)
      return {}
    }
  }
}

/**
 * Convert JSON data to key-value pairs (same logic as Python version)
 */
function convertToKeyValuePairs(data: any): Record<string, string> {
  const pairs: Record<string, string> = {}

  function flatten(currentKey: string, value: any): void {
    if (value === null || value === undefined) {
      return
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) {
        pairs[currentKey] = trimmed
      }
      return
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      pairs[currentKey] = String(value)
      return
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return
      }

      const allScalars = value.every((item) => item === null || item === undefined || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')

      if (allScalars) {
        const entries = value
          .map((item) => (item === null || item === undefined ? '' : String(item).trim()))
          .filter((item) => item.length > 0)

        if (entries.length > 0) {
          pairs[currentKey] = entries.join('|')
        }
      } else {
        value.forEach((item, index) => {
          const childKey = `${currentKey}_${index + 1}`
          flatten(childKey, item)
        })
      }

      return
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value)
      if (entries.length === 0) {
        return
      }

      entries.forEach(([childKey, childValue]) => {
        const nestedKey = currentKey ? `${currentKey}_${childKey}` : childKey
        flatten(nestedKey, childValue)
      })

      return
    }

    // Fallback: stringify anything else
    pairs[currentKey] = String(value)
  }

  if (typeof data === 'object' && data !== null) {
    Object.entries(data).forEach(([key, value]) => flatten(key, value))
  }

  return pairs
}

/**
 * Upsert pair in database (same logic as Python version)
 */
async function upsertPairsBulk(domain: string, guid: string, pairs: Record<string, string>): Promise<void> {
  try {
    const timestamp = new Date().toISOString()
    const payload = Object.entries(pairs).map(([key, value]) => ({
      domain,
      guid,
      key,
      value,
      last_updated: timestamp
    }))

    if (payload.length === 0) {
      return
    }

    const { error } = await supabase
      .from('pairs')
      .upsert(payload, { onConflict: 'pair_id' })

    if (error) {
      throw error
    }
  } catch (error) {
    console.error('Error bulk upserting pairs:', error)
    throw error
  }
}

async function upsertPair(domain: string, guid: string, key: string, value: string): Promise<void> {
  if (value === undefined || value === null) {
    return
  }

  const stringValue = typeof value === 'string' ? value : String(value)

  if (stringValue.trim().length === 0) {
    return
  }

  await upsertPairsBulk(domain, guid, { [key]: stringValue })
}

/**
 * Generate brand document (same as Python version)
 */
async function generateBrandDocument(domain: string, guid: string): Promise<void> {
  try {
    // Get all pairs for the domain
    const { data: allPairs, error: pairsError } = await supabase
      .from('pairs')
      .select('*')
      .eq('domain', domain)
      .eq('guid', guid)

    if (pairsError) {
      throw new Error(`Failed to get pairs: ${pairsError.message}`)
    }

    if (!allPairs || allPairs.length === 0) {
      console.log('No pairs found for brand document generation')
      return
    }

    // Convert pairs to JSON format for prompt
    const pairsJson = JSON.stringify(allPairs, null, 2)

    // Generate brand document using configured model (exact prompt from Python version)
    const brandDocumentPrompt = `Based on the following JSON I want you to generate a markdown file for a brand document. The brand document should be a markdown file that contains all the information from the markdown document, it should be well formated with headings, subheadings and lists when appropriate, you should only respond with the markdown no comments: ${pairsJson}`

    // Use configured model with logging
    const { response: brandDocumentMd } = await callModelWithLogging(
      'synopsis-finalizer',
      brandDocumentPrompt,
      domain,
      {
        task: 'brand_document_generation',
        pairs_count: allPairs.length
      }
    )

    // Store brand document
    await upsertPair(domain, guid, 'brand_document', brandDocumentMd)

    console.log('Successfully generated and stored brand document')

  } catch (error) {
    console.error('Error generating brand document:', error)
    // Don't throw - this is not critical
  }
}

/**
 * Set has_profile flag (same as Python version)
 */
async function setHasProfileFlag(domain: string, guid: string): Promise<void> {
  try {
    await upsertPair(domain, guid, 'has_profile', 'true')
    console.log('Set has_profile flag to true')
  } catch (error) {
    console.error('Error setting has_profile flag:', error)
    // Don't throw - this is not critical
  }
}

/**
 * Mark domain as having a completed synopsis
 */
async function markDomainHasSynopsis(domain: string, guid: string | null): Promise<void> {
  try {
    const fields: Record<string, string | boolean | null> = {
      has_synopsis: true,
      synopsis_generation_guid: null
    }
    if (guid) {
      fields.last_synopsis_guid = guid
    }

    const updated = await upsertDomainMetadata(domain, fields)

    if (!updated) {
      console.warn(`[synopsis-finalizer] domains row not found for ${domain}; has_synopsis not updated`)
    } else {
      console.log(`[synopsis-finalizer] Marked ${domain} has_synopsis = true${guid ? ` (guid: ${guid})` : ''}`)
    }
  } catch (error) {
    console.error('Error updating has_synopsis flag:', error)
    // Don't throw - avoid blocking completion
  }
}

/**
 * Upsert metadata in domains table, creating the row if necessary
 */
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
        console.warn('[synopsis-finalizer] domains.last_synopsis_guid column missing. Retrying upsert without the guid field.')
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
        console.warn('[synopsis-finalizer] domains.synopsis_generation_guid column missing. Retrying without the generation guid field.')
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
    throw error
  }
}
