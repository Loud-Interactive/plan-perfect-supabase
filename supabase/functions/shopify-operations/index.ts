// Supabase Edge Function: shopify-operations
// Description: API endpoint for manually triggering Shopify operations

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Initialize Supabase client
const supabaseUrl = Deno.env.get('PROJECT_URL') || ''
const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY') || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// Main handler function
serve(async (req) => {
  // Set up CORS headers
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  })
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers
    })
  }
  
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405,
        headers 
      }
    )
  }
  
  try {
    // Parse request body
    const requestData = await req.json()
    
    // Validate required fields
    const { operation, content_plan_outline_guid, client_id } = requestData
    
    if (!operation) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: operation' }),
        { status: 400, headers }
      )
    }
    
    if (!content_plan_outline_guid) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: content_plan_outline_guid' }),
        { status: 400, headers }
      )
    }
    
    if (!client_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: client_id' }),
        { status: 400, headers }
      )
    }
    
    // Validate operation type
    const validOperations = ['sync', 'update', 'publish', 'unpublish', 'delete']
    if (!validOperations.includes(operation)) {
      return new Response(
        JSON.stringify({ 
          error: `Invalid operation: ${operation}. Must be one of: ${validOperations.join(', ')}` 
        }),
        { status: 400, headers }
      )
    }
    
    // Map unpublish operation to publish with false status
    let mappedOperation = operation
    let publishStatus = undefined
    
    if (operation === 'publish') {
      publishStatus = true
    } else if (operation === 'unpublish') {
      mappedOperation = 'publish'
      publishStatus = false
    }
    
    // Verify task exists
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('content_plan_outline_guid, client_name')
      .eq('content_plan_outline_guid', content_plan_outline_guid)
      .single()
    
    if (taskError || !task) {
      return new Response(
        JSON.stringify({ 
          error: `Task not found: ${content_plan_outline_guid}` 
        }),
        { status: 404, headers }
      )
    }
    
    // Verify client has Shopify config
    const { data: shopifyConfig, error: configError } = await supabase
      .from('shopify_configs')
      .select('id')
      .eq('client_id', client_id)
      .single()
    
    if (configError || !shopifyConfig) {
      return new Response(
        JSON.stringify({ 
          error: `Shopify configuration not found for client: ${client_id}` 
        }),
        { status: 404, headers }
      )
    }
    
    // Queue the operation
    const { data: queueItem, error: queueError } = await supabase
      .from('outline_shopify_queue')
      .insert({
        content_plan_outline_guid,
        client_id,
        operation: mappedOperation,
        publish_status: publishStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (queueError) {
      return new Response(
        JSON.stringify({ 
          error: `Failed to queue operation: ${queueError.message}` 
        }),
        { status: 500, headers }
      )
    }
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Operation ${operation} queued for processing`,
        queue_item_id: queueItem.id
      }),
      { status: 202, headers }
    )
    
  } catch (error) {
    console.error("Error in shopify-operations:", error)
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers
      }
    )
  }
})