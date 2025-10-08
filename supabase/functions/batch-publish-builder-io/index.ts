import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface PublishResult {
  task_id: string
  success: boolean
  published_url?: string
  error?: string
}

/**
 * Publish single task to Builder.io
 */
async function publishSingleTask(taskId: string): Promise<PublishResult> {
  try {
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/publish-to-builder-io`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ task_id: taskId })
    })

    const result = await response.json()

    if (response.ok && result.success) {
      return {
        task_id: taskId,
        success: true,
        published_url: result.published_url
      }
    } else {
      return {
        task_id: taskId,
        success: false,
        error: result.error || 'Unknown error'
      }
    }
  } catch (error) {
    return {
      task_id: taskId,
      success: false,
      error: error.message
    }
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { 
      task_ids = [], 
      batch_size = 5,
      auto_discover = false,
      limit = 20 
    } = await req.json()

    let targetTaskIds = task_ids

    // Auto-discover unpublished WorkBright tasks if requested
    if (auto_discover && task_ids.length === 0) {
      const { data: unpublishedTasks, error } = await supabase
        .from('tasks')
        .select('task_id')
        .eq('client_domain', 'workbright.com')
        .eq('status', 'Complete')
        .is('live_post_url', null)
        .limit(limit)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`Failed to discover tasks: ${error.message}`)
      }

      targetTaskIds = unpublishedTasks.map((task: any) => task.task_id)
      
      console.log(`Auto-discovered ${targetTaskIds.length} unpublished WorkBright tasks`)
    }

    if (targetTaskIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No tasks to publish',
          results: []
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const results: PublishResult[] = []
    const totalTasks = targetTaskIds.length

    console.log(`Starting batch publish of ${totalTasks} tasks with batch size ${batch_size}`)

    // Process in batches to avoid overwhelming Builder.io API
    for (let i = 0; i < targetTaskIds.length; i += batch_size) {
      const batch = targetTaskIds.slice(i, i + batch_size)
      const batchNumber = Math.floor(i / batch_size) + 1
      const totalBatches = Math.ceil(totalTasks / batch_size)
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} tasks)`)

      // Process batch concurrently
      const batchPromises = batch.map(taskId => publishSingleTask(taskId))
      const batchResults = await Promise.all(batchPromises)
      
      results.push(...batchResults)

      // Brief delay between batches to be respectful to Builder.io API
      if (i + batch_size < targetTaskIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    // Calculate summary statistics
    const successCount = results.filter(r => r.success).length
    const errorCount = results.filter(r => !r.success).length
    
    console.log(`Batch publish complete: ${successCount} success, ${errorCount} errors`)

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total_tasks: totalTasks,
          successful: successCount,
          failed: errorCount,
          batch_size: batch_size
        },
        results: results
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in batch publish:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to batch publish to Builder.io',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})