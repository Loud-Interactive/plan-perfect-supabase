import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { supabaseAdmin } from '../_shared/client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface HealthAlert {
  stage: string
  type: string
  value: number
  threshold: number
  severity: string
}

interface HealthStatus {
  status: string
  timestamp: string
  alerts: HealthAlert[]
  alert_count: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const durationThresholdMs = Number(url.searchParams.get('duration_threshold_ms') || '300000') // 5 min
  const errorRateThreshold = Number(url.searchParams.get('error_rate_threshold') || '0.1') // 10%
  const queueDepthThreshold = Number(url.searchParams.get('queue_depth_threshold') || '100')
  const sendAlert = url.searchParams.get('send_alert') === 'true'

  try {
    // Get health status from database function
    const { data, error } = await supabaseAdmin.rpc('get_pipeline_health_status', {
      p_duration_threshold_ms: durationThresholdMs,
      p_error_rate_threshold: errorRateThreshold,
      p_queue_depth_threshold: queueDepthThreshold,
    })

    if (error) {
      console.error('Error fetching health status', error)
      return new Response(JSON.stringify({ error: 'Failed to fetch health status' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const healthStatus = data as HealthStatus

    // Send alerts if requested and there are critical issues
    if (sendAlert && healthStatus.alerts && healthStatus.alerts.length > 0) {
      const criticalAlerts = healthStatus.alerts.filter((a: HealthAlert) => a.severity === 'critical')
      
      if (criticalAlerts.length > 0) {
        await sendHealthAlerts(healthStatus)
      }
    }

    return new Response(
      JSON.stringify({
        health: healthStatus,
        thresholds: {
          duration_ms: durationThresholdMs,
          error_rate: errorRateThreshold,
          queue_depth: queueDepthThreshold,
        },
      }),
      {
        status: healthStatus.status === 'unhealthy' ? 503 : 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (err) {
    console.error('Unexpected error in content-healthcheck', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function sendHealthAlerts(healthStatus: HealthStatus) {
  // Get webhook URL from environment or app settings
  const webhookUrl = Deno.env.get('HEALTH_ALERT_WEBHOOK_URL')
  
  if (!webhookUrl) {
    console.warn('HEALTH_ALERT_WEBHOOK_URL not configured, skipping alert')
    return
  }

  const alertPayload = {
    title: `Content Pipeline Health Alert: ${healthStatus.status}`,
    status: healthStatus.status,
    timestamp: healthStatus.timestamp,
    alert_count: healthStatus.alert_count,
    alerts: healthStatus.alerts,
    details: healthStatus.alerts.map((alert: HealthAlert) => 
      `[${alert.severity.toUpperCase()}] ${alert.stage}: ${alert.type} - value: ${alert.value}, threshold: ${alert.threshold}`
    ).join('\n'),
  }

  try {
    // Try pg_net first for database-level webhooks
    const { error: pgNetError } = await supabaseAdmin.rpc('http_post', {
      url: webhookUrl,
      headers: JSON.stringify({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(alertPayload),
      timeout_milliseconds: 5000,
    }).catch(() => ({ error: 'pg_net not available' }))

    if (pgNetError) {
      // Fall back to direct fetch
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alertPayload),
      })

      if (!response.ok) {
        console.error('Failed to send alert via fetch', response.status, await response.text())
      } else {
        console.log('Health alert sent successfully via fetch')
      }
    } else {
      console.log('Health alert sent successfully via pg_net')
    }
  } catch (error) {
    console.error('Failed to send health alert', error)
  }
}
