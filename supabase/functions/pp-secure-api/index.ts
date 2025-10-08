import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface ApiRequest {
  action: 'getBatchStatus' | 'getBatchResults' | 'getUserJobs' | 'getSystemMetrics'
  params: Record<string, any>
}

interface ApiResponse {
  success: boolean
  data?: any
  error?: string
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Create client with user's token for RLS
    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    const { action, params } = await req.json() as ApiRequest

    let result: any

    switch (action) {
      case 'getBatchStatus': {
        const { batchId } = params
        
        // Verify user owns this batch
        const { data: batch, error: batchError } = await supabase
          .from('pp_batch_jobs')
          .select('*')
          .eq('id', batchId)
          .eq('user_id', user.id)
          .single()

        if (batchError || !batch) {
          throw new Error('Batch not found or access denied')
        }

        // Get detailed progress
        const { data: progress } = await supabase
          .from('pp_batch_progress')
          .select('*')
          .eq('batch_id', batchId)

        // Get performance metrics
        const { data: performance } = await supabase
          .from('pp_batch_performance_simple')
          .select('*')
          .eq('batch_id', batchId)
          .single()

        // Get recent activity
        const { data: recentActivity } = await supabase
          .from('seo_processing_tracking')
          .select(`
            job_id,
            stage,
            success,
            error_message,
            processing_end,
            crawl_jobs!inner(
              page_id,
              pages!inner(
                domain,
                path
              )
            )
          `)
          .eq('pp_batch_id', batchId)
          .order('processing_end', { ascending: false })
          .limit(10)

        result = {
          batch,
          progress: formatProgress(progress || []),
          performance: performance || null,
          recentActivity: formatRecentActivity(recentActivity || [])
        }
        break
      }

      case 'getBatchResults': {
        const { batchId, offset = 0, limit = 50 } = params

        // Verify user owns this batch
        const { data: batch, error: batchError } = await supabase
          .from('pp_batch_jobs')
          .select('id')
          .eq('id', batchId)
          .eq('user_id', user.id)
          .single()

        if (batchError || !batch) {
          throw new Error('Batch not found or access denied')
        }

        // Get results with pagination
        const { data: results, error: resultsError, count } = await supabase
          .from('seo_processing_tracking')
          .select(`
            *,
            crawl_jobs!inner(
              page_id,
              pages!inner(
                domain,
                path,
                seo_analysis
              )
            ),
            seo_recommendations!job_id(*)
          `, { count: 'exact' })
          .eq('pp_batch_id', batchId)
          .range(offset, offset + limit - 1)
          .order('processing_end', { ascending: false })

        if (resultsError) throw resultsError

        result = {
          results: results || [],
          total: count || 0,
          offset,
          limit
        }
        break
      }

      case 'getUserJobs': {
        // Get user's recent jobs
        const { data: userJobs, error } = await supabase
          .from('pp_user_jobs')
          .select(`
            job_id,
            created_at,
            crawl_jobs!inner(
              status,
              pages!inner(
                domain,
                path
              )
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20)

        if (error) throw error

        result = userJobs || []
        break
      }

      case 'getSystemMetrics': {
        // Only allow admin users to view system metrics
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        if (profile?.role !== 'admin') {
          throw new Error('Admin access required')
        }

        // Get system metrics
        const { data: metrics, error } = await supabase
          .from('pp_system_metrics')
          .select('*')
          .single()

        if (error) throw error

        result = metrics
        break
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: result
      } as ApiResponse),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Secure API error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred'
      } as ApiResponse),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message === 'Unauthorized' ? 401 : 400
      }
    )
  }
})

// Helper functions
function formatProgress(progress: any[]): any {
  const stages = ['crawling', 'gscData', 'seoAnalysis', 'seoGeneration', 'overall']
  const result: any = {}

  stages.forEach(stage => {
    const stageData = progress.find(p => p.stage === stage) || {
      completed: 0,
      failed: 0,
      in_progress: 0
    }

    const total = stageData.completed + stageData.failed + stageData.in_progress
    result[stage] = {
      ...stageData,
      total,
      percentage: total > 0 ? (stageData.completed / total) * 100 : 0
    }
  })

  return result
}

function formatRecentActivity(activities: any[]): any[] {
  return activities.map(activity => ({
    url: `https://${activity.crawl_jobs.pages.domain}${activity.crawl_jobs.pages.path}`,
    status: activity.success ? 'success' : activity.processing_end ? 'failed' : 'processing',
    stage: activity.stage,
    timestamp: activity.processing_end || new Date().toISOString(),
    error: activity.error_message
  }))
}