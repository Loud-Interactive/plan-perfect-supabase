import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface BatchRequest {
  urls: string[]
  name?: string
  metadata?: Record<string, any>
}

interface BatchResponse {
  success: boolean
  batchId?: string
  totalUrls?: number
  createdJobs?: number
  existingJobs?: number
  error?: string
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Create client with user's token for proper RLS
    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        headers: {
          Authorization: authHeader // Pass through user's auth
        }
      }
    })

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    const { urls, name, metadata } = await req.json() as BatchRequest

    // Validate request
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      throw new Error('URLs array is required and must not be empty')
    }

    // Validate batch submission (rate limits, size, etc.)
    const { data: validation, error: validationError } = await supabase
      .rpc('validate_batch_submission', {
        p_user_id: user.id,
        p_url_count: urls.length
      })
      .single()

    if (validationError || !validation?.allowed) {
      throw new Error(validation?.reason || 'Batch validation failed')
    }

    // Clean and validate URLs
    const validatedUrls = urls.map(url => {
      try {
        const parsed = new URL(url)
        return parsed.href
      } catch {
        throw new Error(`Invalid URL: ${url}`)
      }
    })

    // Remove duplicates
    const uniqueUrls = [...new Set(validatedUrls)]

    // Start a transaction for batch creation
    const { data: batchJob, error: batchError } = await supabase
      .from('pp_batch_jobs')
      .insert({
        user_id: user.id,
        name: name || `Batch ${new Date().toISOString()}`,
        total_urls: uniqueUrls.length,
        status: 'processing',
        metadata: metadata || {}
      })
      .select()
      .single()

    if (batchError || !batchJob) {
      throw new Error(`Failed to create batch job: ${batchError?.message}`)
    }

    console.log(`Created batch job ${batchJob.id} for ${uniqueUrls.length} URLs`)

    // Process URLs in smaller chunks to avoid memory issues
    const CHUNK_SIZE = 100
    let createdJobs = 0
    let existingJobs = 0
    const errors: string[] = []

    for (let i = 0; i < uniqueUrls.length; i += CHUNK_SIZE) {
      const chunk = uniqueUrls.slice(i, i + CHUNK_SIZE)
      
      try {
        // Process chunk in a transaction
        const { data: pages, error: pagesError } = await supabase.rpc('process_batch_urls', {
          p_batch_id: batchJob.id,
          p_urls: chunk,
          p_user_id: user.id
        })

        if (pagesError) {
          errors.push(`Chunk ${i / CHUNK_SIZE + 1} error: ${pagesError.message}`)
          continue
        }

        if (pages) {
          createdJobs += pages.filter((p: any) => p.job_created).length
          existingJobs += pages.filter((p: any) => !p.job_created).length
        }

        // Update batch progress
        await supabase
          .from('pp_batch_jobs')
          .update({
            processed_urls: createdJobs + existingJobs
          })
          .eq('id', batchJob.id)

      } catch (chunkError) {
        console.error(`Error processing chunk ${i / CHUNK_SIZE + 1}:`, chunkError)
        errors.push(`Chunk ${i / CHUNK_SIZE + 1} error: ${chunkError.message}`)
      }
    }

    // Update final batch status
    const finalStatus = errors.length > 0 ? 'processing_with_errors' : 'processing'
    await supabase
      .from('pp_batch_jobs')
      .update({
        status: finalStatus,
        processed_urls: createdJobs + existingJobs,
        metadata: {
          ...batchJob.metadata,
          errors: errors.length > 0 ? errors : undefined
        }
      })
      .eq('id', batchJob.id)

    return new Response(
      JSON.stringify({
        success: true,
        batchId: batchJob.id,
        totalUrls: uniqueUrls.length,
        createdJobs,
        existingJobs,
        errors: errors.length > 0 ? errors : undefined
      } as BatchResponse),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Batch orchestrator error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred'
      } as BatchResponse),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' ? 401 : 400
      }
    )
  }
})