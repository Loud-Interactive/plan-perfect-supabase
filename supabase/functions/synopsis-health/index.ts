// Synopsis Health Monitoring Function
// Provides comprehensive health status of the Synopsis Perfect system

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

interface HealthResponse {
  timestamp: string;
  health: {
    apis: Array<{
      name: string;
      healthy: boolean;
      circuitBreaker: string;
      quotaUsage: number;
      lastSuccess: string | null;
      consecutiveFailures: number;
    }>;
    summary: {
      healthy: number;
      total: number;
    };
  };
  jobs: {
    total: number;
    completed: number;
    partial: number;
    failed: number;
    processing: number;
    averageQuality: number;
  };
  checkpoints: {
    resumable: number;
    total: number;
  };
  recommendations: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get API health status
    const { data: apiHealth, error: apiError } = await supabase
      .from('synopsis_api_health')
      .select('*')
      .order('api_name')

    if (apiError) {
      throw new Error(`Failed to get API health: ${apiError.message}`)
    }

    // Get job statistics (last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: recentJobs, error: jobsError } = await supabase
      .from('synopsis_jobs')
      .select('status, partial_status, quality_score')
      .gte('created_at', yesterday)

    if (jobsError) {
      throw new Error(`Failed to get job stats: ${jobsError.message}`)
    }

    // Calculate job statistics
    const jobStats = {
      total: recentJobs?.length || 0,
      completed: recentJobs?.filter(j => j.status === 'completed').length || 0,
      partial: recentJobs?.filter(j => j.status === 'partially_completed').length || 0,
      failed: recentJobs?.filter(j => j.status === 'failed').length || 0,
      processing: recentJobs?.filter(j => j.status === 'processing').length || 0,
      averageQuality: recentJobs && recentJobs.length > 0
        ? recentJobs.reduce((sum, j) => sum + (j.quality_score || 0), 0) / recentJobs.length
        : 0
    }

    // Get checkpoint statistics
    const { data: checkpoints, error: checkpointError } = await supabase
      .from('synopsis_jobs')
      .select('id, checkpoint_data, status')
      .not('checkpoint_data', 'is', null)
      .in('status', ['failed', 'processing'])

    if (checkpointError) {
      console.error('Failed to get checkpoints:', checkpointError)
    }

    // Count resumable jobs (checkpoints less than 24 hours old)
    const resumableJobs = (checkpoints || []).filter(job => {
      if (!job.checkpoint_data) return false
      const checkpoint = job.checkpoint_data as any
      const age = Date.now() - new Date(checkpoint.timestamp).getTime()
      return age < 24 * 60 * 60 * 1000
    }).length

    // Process API health data
    const processedApiHealth = (apiHealth || []).map(api => ({
      name: api.api_name,
      healthy: api.is_healthy,
      circuitBreaker: api.circuit_breaker_state,
      quotaUsage: api.daily_quota_limit > 0 
        ? api.daily_quota_used / api.daily_quota_limit 
        : 0,
      lastSuccess: api.last_success_at,
      consecutiveFailures: api.consecutive_failures
    }))

    // Generate recommendations
    const recommendations: string[] = []
    
    // Check API health
    const unhealthyAPIs = processedApiHealth.filter(api => !api.healthy)
    if (unhealthyAPIs.length > 0) {
      recommendations.push(
        `⚠️ ${unhealthyAPIs.length} APIs unhealthy: ${unhealthyAPIs.map(a => a.name).join(', ')}`
      )
    }

    const openCircuits = processedApiHealth.filter(api => api.circuitBreaker === 'open')
    if (openCircuits.length > 0) {
      recommendations.push(
        `🔌 ${openCircuits.length} circuit breakers open: ${openCircuits.map(a => a.name).join(', ')}`
      )
    }

    // Check API quotas
    const highQuotaAPIs = processedApiHealth.filter(api => api.quotaUsage > 0.8)
    if (highQuotaAPIs.length > 0) {
      recommendations.push(
        `📊 High quota usage: ${highQuotaAPIs.map(a => `${a.name} (${Math.round(a.quotaUsage * 100)}%)`).join(', ')}`
      )
    }

    // Check success rate
    if (jobStats.total > 5) {
      const successRate = (jobStats.completed + jobStats.partial) / jobStats.total
      if (successRate < 0.8) {
        recommendations.push(
          `📉 Low success rate: ${(successRate * 100).toFixed(1)}%`
        )
      }
    }

    // Check quality
    if (jobStats.total > 5 && jobStats.averageQuality < 0.6) {
      recommendations.push(
        `⚠️ Low average quality: ${(jobStats.averageQuality * 100).toFixed(1)}%`
      )
    }

    // Check resumable jobs
    if (resumableJobs > 0) {
      recommendations.push(
        `🔄 ${resumableJobs} jobs can be resumed from checkpoint`
      )
    }

    // Check for stuck processing jobs
    const { data: stuckJobs } = await supabase
      .from('synopsis_jobs')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Older than 1 hour

    if (stuckJobs && stuckJobs.length > 0) {
      recommendations.push(
        `⏰ ${stuckJobs.length} jobs stuck in processing state`
      )
    }

    // If everything is good
    if (recommendations.length === 0) {
      recommendations.push('✅ All systems operational')
    }

    const response: HealthResponse = {
      timestamp: new Date().toISOString(),
      health: {
        apis: processedApiHealth,
        summary: {
          healthy: processedApiHealth.filter(a => a.healthy).length,
          total: processedApiHealth.length
        }
      },
      jobs: jobStats,
      checkpoints: {
        resumable: resumableJobs,
        total: checkpoints?.length || 0
      },
      recommendations
    }

    return new Response(
      JSON.stringify(response, null, 2),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error in synopsis-health:', error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})