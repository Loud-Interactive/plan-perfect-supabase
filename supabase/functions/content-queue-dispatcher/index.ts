import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { supabaseAdmin } from '../_shared/client.ts'

interface StageConfig {
  stage: string
  queue: string
  max_concurrency: number
  worker_endpoint: string
  enabled: boolean
  trigger_batch_size: number
}

interface BacklogRow {
  stage: string
  ready_count: number | null
  inflight_count: number | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const startTime = Date.now()
  const dispatches: Array<{ stage: string; queue: string; workers_triggered: number }> = []
  const errors: Array<{ stage: string; error: string }> = []

  try {
    // Fetch stage configurations
    const { data: stageConfigs, error: configError } = await supabaseAdmin
      .from('content_stage_config')
      .select('*')
      .eq('enabled', true)
      .order('stage')

    if (configError) {
      throw new Error(`Failed to fetch stage configs: ${configError.message}`)
    }

    if (!stageConfigs || stageConfigs.length === 0) {
      console.log('No enabled stage configurations found')
      return new Response(
        JSON.stringify({
          message: 'No enabled stage configurations',
          duration_ms: Date.now() - startTime,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Get backlog metrics per stage
    const { data: backlogData, error: backlogError } = await supabaseAdmin.rpc('get_content_stage_backlog')

    if (backlogError) {
      console.error('Failed to get stage backlog:', backlogError)
      errors.push({ stage: 'all', error: backlogError.message })
    }

    const backlogMap = new Map<string, { ready_count: number; inflight_count: number }>()
    if (backlogData && Array.isArray(backlogData)) {
      for (const row of backlogData as BacklogRow[]) {
        backlogMap.set(row.stage, {
          ready_count: Number(row.ready_count ?? 0),
          inflight_count: Number(row.inflight_count ?? 0),
        })
      }
    }

    // Process each stage configuration
    for (const raw of stageConfigs as StageConfig[]) {
      try {
        const config = {
          ...raw,
          max_concurrency: Number(raw.max_concurrency ?? 0),
          trigger_batch_size: Number(raw.trigger_batch_size ?? 1),
        }

        const backlog = backlogMap.get(config.stage)
        const readyCount = backlog ? backlog.ready_count : 0
        const inFlightCount = backlog ? backlog.inflight_count : 0

        if (readyCount === 0) {
          console.log(`Stage ${config.stage} has no ready jobs, skipping`)
          continue
        }

        // Check env override for max_concurrency
        const envKey = `CONTENT_STAGE_${config.stage.toUpperCase()}_MAX_CONCURRENCY`
        const envOverride = Deno.env.get(envKey)
        const parsedOverride = envOverride ? Number.parseInt(envOverride, 10) : NaN
        const effectiveMaxConcurrency = Number.isFinite(parsedOverride) && !Number.isNaN(parsedOverride)
          ? parsedOverride
          : config.max_concurrency

        if (effectiveMaxConcurrency <= 0) {
          console.log(`Stage ${config.stage} disabled via concurrency <= 0, skipping`)
          continue
        }

        const availableSlots = Math.max(0, effectiveMaxConcurrency - inFlightCount)

        console.log(
          `Stage ${config.stage}: ready=${readyCount}, in_flight=${inFlightCount}, ` +
            `max=${effectiveMaxConcurrency}, available=${availableSlots}`
        )

        if (availableSlots === 0) {
          console.log(`Stage ${config.stage} at max concurrency (${effectiveMaxConcurrency}), skipping`)
          continue
        }

        const batchSize = Math.max(1, config.trigger_batch_size ?? 1)

        // Trigger workers up to available slots (capped at ready count and batch size)
        const workersToTrigger = Math.min(availableSlots, readyCount, batchSize)

        let triggeredCount = 0
        for (let i = 0; i < workersToTrigger; i++) {
          try {
            const { error: httpError } = await supabaseAdmin.rpc('trigger_content_worker', {
              p_worker_endpoint: config.worker_endpoint,
              p_stage: config.stage,
              p_queue: config.queue,
            })

            if (httpError) {
              console.error(`Failed to trigger worker for stage ${config.stage}:`, httpError)
              errors.push({ stage: config.stage, error: httpError.message })
              break
            }

            triggeredCount++
          } catch (err) {
            console.error(`Exception triggering worker for stage ${config.stage}:`, err)
            errors.push({ stage: config.stage, error: String(err) })
            break
          }
        }

        if (triggeredCount > 0) {
          dispatches.push({
            stage: config.stage,
            queue: config.queue,
            workers_triggered: triggeredCount,
          })
          console.log(`Triggered ${triggeredCount} workers for stage ${config.stage}`)
        }
      } catch (err) {
        console.error(`Exception processing stage ${config.stage}:`, err)
        errors.push({ stage: config.stage, error: String(err) })
      }
    }

    const duration = Date.now() - startTime

    return new Response(
      JSON.stringify({
        message: 'Dispatch cycle completed',
        dispatches,
        errors: errors.length > 0 ? errors : undefined,
        duration_ms: duration,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Dispatcher error:', error)
    return new Response(
      JSON.stringify({
        error: 'Dispatcher failed',
        message: String(error),
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
