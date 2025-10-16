#!/usr/bin/env -S deno run --allow-env --allow-net

interface MonitorOptions {
  baseUrl: string
  apiKey?: string
  timeWindow: string
  stage?: string
  metricType?: string
  sendAlert: boolean
}

function parseArgs(): MonitorOptions {
  const args = new Map<string, string>()

  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = Deno.args[i + 1] && !Deno.args[i + 1].startsWith('--') ? Deno.args[i + 1] : 'true'
      if (value !== 'true') {
        i++
      }
      args.set(key, value)
    }
  }

  const baseUrl = args.get('base-url') ?? Deno.env.get('SUPABASE_FUNCTIONS_URL')
  if (!baseUrl) {
    console.error('Missing required --base-url argument or SUPABASE_FUNCTIONS_URL env variable')
    Deno.exit(1)
  }

  return {
    baseUrl,
    apiKey: args.get('api-key') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY'),
    timeWindow: args.get('time-window') ?? '1h',
    stage: args.get('stage'),
    metricType: args.get('metric-type'),
    sendAlert: args.get('send-alert') === 'true' || args.has('send-alert') || Deno.env.get('PIPELINE_SEND_ALERTS') === 'true',
  }
}

async function fetchJson(url: string, apiKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['apikey'] = apiKey
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const response = await fetch(url, { headers })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed (${response.status}): ${body}`)
  }

  return response.json()
}

function buildUrl(baseUrl: string, path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  })
  return url.toString()
}

async function main() {
  const options = parseArgs()
  const functionsBase = options.baseUrl.includes('/functions/v1')
    ? options.baseUrl
    : `${options.baseUrl.replace(/\/+$/, '')}/functions/v1`

  console.log('Running PlanPerfect pipeline monitor with options:', {
    baseUrl: functionsBase,
    timeWindow: options.timeWindow,
    stage: options.stage,
    metricType: options.metricType,
    sendAlert: options.sendAlert,
  })

  const metricsUrl = buildUrl(functionsBase, '/content-metrics', {
    summary: true,
    time_window: options.timeWindow,
    stage: options.stage,
    metric_type: options.metricType,
  })

  const healthUrl = buildUrl(functionsBase, '/content-healthcheck', {
    send_alert: options.sendAlert,
  })

  try {
    const metrics = await fetchJson(metricsUrl, options.apiKey)
    const health = await fetchJson(healthUrl, options.apiKey)

    console.log('\n=== Metrics Summary ===')
    const summary = metrics.summary ?? []
    if (summary.length === 0) {
      console.log('No metrics available for the selected window')
    } else {
      for (const row of summary) {
        console.log(
          `Stage=${row.stage} type=${row.metric_type} window=${row.time_bucket} avg=${Number(row.avg_value).toFixed(2)} p95=${Number(row.p95_value).toFixed(2)} count=${row.metric_count}`
        )
      }
    }

    console.log('\n=== Pipeline Health ===')
    console.log(`Status: ${health.health?.status}`)
    console.log(`Alerts: ${health.health?.alert_count}`)
    if (health.health?.alerts?.length) {
      for (const alert of health.health.alerts as Array<Record<string, unknown>>) {
        console.log(`- [${alert.severity}] ${alert.stage} ${alert.type} value=${alert.value} threshold=${alert.threshold}`)
      }
    }

    if (health.health?.status === 'unhealthy') {
      console.error('Pipeline reported unhealthy status')
      Deno.exit(2)
    } else if (health.health?.status === 'degraded') {
      console.warn('Pipeline reported degraded status')
      Deno.exit(3)
    } else {
      console.log('Pipeline status is healthy')
    }
  } catch (error) {
    console.error('Monitoring failed:', error)
    Deno.exit(1)
  }
}

if (import.meta.main) {
  main()
}
