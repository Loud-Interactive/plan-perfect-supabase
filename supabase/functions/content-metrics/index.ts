import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabaseAdmin } from '../_shared/client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const stage = url.searchParams.get('stage')
  const metricType = url.searchParams.get('metric_type')
  const timeWindow = url.searchParams.get('time_window') || '1h'
  const summary = url.searchParams.get('summary') === 'true'

  try {
    // Parse time window
    const timeWindowMap: Record<string, string> = {
      '5m': '5 minutes',
      '15m': '15 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    }
    const intervalStr = timeWindowMap[timeWindow] || '1 hour'

    if (summary) {
      // Return aggregated summary from materialized view
      let query = supabaseAdmin
        .from('v_content_metrics_summary')
        .select('*')
        .gte('time_bucket', `now() - interval '${intervalStr}'`)
        .order('time_bucket', { ascending: false })

      if (stage) {
        query = query.eq('stage', stage)
      }
      if (metricType) {
        query = query.eq('metric_type', metricType)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching metrics summary', error)
        return new Response(JSON.stringify({ error: 'Failed to fetch metrics summary' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(
        JSON.stringify({
          summary: data,
          time_window: timeWindow,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Return raw metrics
    let query = supabaseAdmin
      .from('content_job_metrics')
      .select('*')
      .gte('recorded_at', `now() - interval '${intervalStr}'`)
      .order('recorded_at', { ascending: false })
      .limit(1000)

    if (stage) {
      query = query.eq('stage', stage)
    }
    if (metricType) {
      query = query.eq('metric_type', metricType)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching metrics', error)
      return new Response(JSON.stringify({ error: 'Failed to fetch metrics' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Calculate real-time aggregations
    const aggregations: Record<string, unknown> = {}
    
    if (data && data.length > 0) {
      const values = data.map((m) => Number(m.metric_value))
      values.sort((a, b) => a - b)

      aggregations.count = values.length
      aggregations.min = Math.min(...values)
      aggregations.max = Math.max(...values)
      aggregations.avg = values.reduce((a, b) => a + b, 0) / values.length
      aggregations.p50 = values[Math.floor(values.length * 0.5)]
      aggregations.p95 = values[Math.floor(values.length * 0.95)]
      aggregations.p99 = values[Math.floor(values.length * 0.99)]
    }

    return new Response(
      JSON.stringify({
        metrics: data,
        aggregations,
        time_window: timeWindow,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (err) {
    console.error('Unexpected error in content-metrics', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
