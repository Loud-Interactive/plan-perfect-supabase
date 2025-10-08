import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface WebhookPayload {
  type: 'UPDATE'
  table: string
  record: any
  old_record: any
  schema: string
}

/**
 * Check if task status changed to Complete
 */
function isTaskCompleted(payload: WebhookPayload): boolean {
  return (
    payload.type === 'UPDATE' &&
    payload.table === 'tasks' &&
    payload.record?.client_domain && // Any domain
    payload.record?.status === 'Complete' &&
    payload.old_record?.status !== 'Complete'
  )
}

/**
 * Trigger Builder.io publication using universal client function
 */
async function triggerBuilderIoPublication(taskId: string, clientDomain: string): Promise<any> {
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/publish-to-client-builder`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ 
      task_id: taskId,
      client_domain: clientDomain,
      auto_publish: true 
    })
  })

  const result = await response.json()
  
  if (!response.ok) {
    throw new Error(`Failed to publish task ${taskId} for ${clientDomain}: ${result.error}`)
  }
  
  return result
}

/**
 * Log auto-publish activity
 */
async function logAutoPublishActivity(
  supabase: any,
  taskId: string,
  success: boolean,
  publishedUrl?: string,
  error?: string
): Promise<void> {
  try {
    await supabase
      .from('publication_logs')
      .insert({
        task_id: taskId,
        publication_type: 'builder_io_auto',
        status: success ? 'published' : 'failed',
        published_url: publishedUrl,
        error_message: error,
        published_at: new Date().toISOString()
      })
  } catch (logError) {
    console.error('Failed to log auto-publish activity:', logError)
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

    // Parse webhook payload
    const payload: WebhookPayload = await req.json()
    
    console.log('Auto-publish trigger received:', {
      type: payload.type,
      table: payload.table,
      task_id: payload.record?.task_id,
      client_domain: payload.record?.client_domain,
      status: payload.record?.status,
      old_status: payload.old_record?.status
    })

    // Check if this is a task completion
    if (!isTaskCompleted(payload)) {
      return new Response(
        JSON.stringify({ 
          message: 'No action needed - not a task completion',
          processed: false
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const taskId = payload.record.task_id
    const clientDomain = payload.record.client_domain
    
    console.log(`Checking auto-publish configuration for ${clientDomain}`)

    // Check if this client has Builder.io configuration with auto-publish enabled
    const { data: config, error: configError } = await supabase
      .from('client_builder_configs')
      .select('auto_publish_enabled, active, client_domain')
      .eq('client_domain', clientDomain)
      .eq('active', true)
      .single()

    if (configError || !config) {
      console.log(`No active Builder.io configuration found for ${clientDomain}`)
      return new Response(
        JSON.stringify({ 
          message: `No active Builder.io configuration found for domain: ${clientDomain}`,
          processed: false,
          task_id: taskId,
          client_domain: clientDomain
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    if (!config.auto_publish_enabled) {
      console.log(`Auto-publish disabled for ${clientDomain}`)
      return new Response(
        JSON.stringify({ 
          message: `Auto-publish is disabled for domain: ${clientDomain}`,
          processed: false,
          task_id: taskId,
          client_domain: clientDomain,
          auto_publish_enabled: false
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
    
    console.log(`Auto-publishing task ${taskId} for ${clientDomain} to Builder.io`)

    try {
      // Trigger publication
      const publishResult = await triggerBuilderIoPublication(taskId, clientDomain)
      
      // Log successful publication
      await logAutoPublishActivity(
        supabase,
        taskId,
        true,
        publishResult.published_url
      )

      console.log(`Successfully auto-published task ${taskId} for ${clientDomain} to ${publishResult.published_url}`)

      return new Response(
        JSON.stringify({
          success: true,
          task_id: taskId,
          client_domain: clientDomain,
          published_url: publishResult.published_url,
          auto_published: true
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )

    } catch (publishError) {
      // Log failed publication
      await logAutoPublishActivity(
        supabase,
        taskId,
        false,
        undefined,
        publishError.message
      )

      console.error(`Failed to auto-publish task ${taskId} for ${clientDomain}:`, publishError)

      return new Response(
        JSON.stringify({
          success: false,
          task_id: taskId,
          client_domain: clientDomain,
          error: publishError.message,
          auto_published: false
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

  } catch (error) {
    console.error('Error in auto-publish trigger:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process auto-publish trigger',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})