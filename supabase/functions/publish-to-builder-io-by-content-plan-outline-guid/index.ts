import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

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

    const { content_plan_outline_guid, auto_publish = false } = await req.json()

    if (!content_plan_outline_guid) {
      return new Response(
        JSON.stringify({ error: 'content_plan_outline_guid is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Publishing to Builder.io by outline GUID: ${content_plan_outline_guid}`)

    // Find the WorkBright task associated with this content plan outline GUID
    const { data: task, error: fetchError } = await supabase
      .from('tasks')
      .select('task_id, title, content, client_domain, seo_keyword, status, created_at, live_post_url, hero_image_url, hero_image_prompt, content_plan_outline_guid')
      .eq('content_plan_outline_guid', content_plan_outline_guid)
      .eq('client_domain', 'workbright.com')
      .eq('status', 'Complete')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (fetchError || !task) {
      console.error('Task lookup error:', fetchError)
      return new Response(
        JSON.stringify({ 
          error: 'No completed WorkBright task found for this content plan outline GUID',
          details: fetchError?.message || 'Task not found',
          content_plan_outline_guid: content_plan_outline_guid
        }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Found WorkBright task: ${task.task_id} for outline GUID: ${content_plan_outline_guid}`)

    // Check if already published (unless forcing republish)
    if (task.live_post_url && !auto_publish) {
      return new Response(
        JSON.stringify({ 
          message: 'Task already published to Builder.io',
          task_id: task.task_id,
          content_plan_outline_guid: content_plan_outline_guid,
          published_url: task.live_post_url,
          already_published: true
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Call the main publish-to-builder-io function
    const publishUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/publish-to-builder-io`
    const publishResponse = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task_id: task.task_id,
        auto_publish: auto_publish
      })
    })

    if (!publishResponse.ok) {
      const errorText = await publishResponse.text()
      console.error(`Error calling publish-to-builder-io: ${publishResponse.status} - ${errorText}`)
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to publish to Builder.io',
          details: `HTTP ${publishResponse.status}: ${errorText}`,
          task_id: task.task_id,
          content_plan_outline_guid: content_plan_outline_guid
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const publishResult = await publishResponse.json()
    
    console.log(`Successfully published task ${task.task_id} to Builder.io via outline GUID: ${content_plan_outline_guid}`)

    // Return the result with additional GUID context
    const response = {
      ...publishResult,
      content_plan_outline_guid: content_plan_outline_guid,
      task_lookup: {
        found_task_id: task.task_id,
        task_title: task.title,
        lookup_method: 'content_plan_outline_guid'
      }
    }

    return new Response(
      JSON.stringify(response),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in publish-to-builder-io-by-content-plan-outline-guid:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process publication request',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})