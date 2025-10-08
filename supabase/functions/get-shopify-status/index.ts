// Supabase Edge Function: get-shopify-status
// Description: API endpoint for retrieving Shopify sync status

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  })
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers
    })
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405,
        headers 
      }
    )
  }
  
  try {
    // Parse URL and get query parameters
    const url = new URL(req.url)
    const clientId = url.searchParams.get('client_id')
    const outlineGuid = url.searchParams.get('outline_guid')
    const includeQueueStatus = url.searchParams.get('include_queue') === 'true'
    
    // Need at least client_id or outline_guid
    if (!clientId && !outlineGuid) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: client_id or outline_guid' }),
        { status: 400, headers }
      )
    }
    
    // Initialize query
    let query = supabase
      .from('content_plan_outlines')
      .select(`
        guid,
        title,
        status,
        client_id,
        created_at,
        updated_at,
        shopify_sync_status (
          id,
          shopify_article_gid,
          shopify_handle,
          post_url,
          is_published,
          last_synced_at,
          sync_error
        )
      `)
    
    // Apply filters
    if (outlineGuid) {
      query = query.eq('guid', outlineGuid)
    } else if (clientId) {
      query = query.eq('client_id', clientId)
    }
    
    // Execute query
    const { data: outlines, error: outlinesError } = await query
    
    if (outlinesError) {
      return new Response(
        JSON.stringify({ error: `Error fetching outlines: ${outlinesError.message}` }),
        { status: 500, headers }
      )
    }
    
    // Include queue status if requested
    if (includeQueueStatus) {
      // Get list of outline guids
      const outlineGuids = outlines.map(o => o.guid)
      
      if (outlineGuids.length > 0) {
        // Get queue items for these outlines
        const { data: queueItems, error: queueError } = await supabase
          .from('outline_shopify_queue')
          .select('*')
          .in('content_plan_outline_guid', outlineGuids)
          .is('processed_at', null)
        
        if (!queueError && queueItems) {
          // Group queue items by outline guid
          const queueByOutline = queueItems.reduce((acc, item) => {
            if (!acc[item.content_plan_outline_guid]) {
              acc[item.content_plan_outline_guid] = []
            }
            acc[item.content_plan_outline_guid].push(item)
            return acc
          }, {})
          
          // Add queue info to outlines
          outlines.forEach(outline => {
            outline.queue_items = queueByOutline[outline.guid] || []
          })
        }
      }
    }
    
    // Format response
    const response = {
      total: outlines.length,
      records: outlines.map(outline => {
        const syncStatus = outline.shopify_sync_status || []
        const firstSyncStatus = syncStatus.length > 0 ? syncStatus[0] : null
        
        return {
          guid: outline.guid,
          title: outline.title,
          status: outline.status,
          client_id: outline.client_id,
          created_at: outline.created_at,
          updated_at: outline.updated_at,
          shopify_sync: {
            is_synced: !!firstSyncStatus,
            article_id: firstSyncStatus?.shopify_article_gid || null,
            handle: firstSyncStatus?.shopify_handle || null,
            post_url: firstSyncStatus?.post_url || null,
            is_published: firstSyncStatus?.is_published || false,
            last_synced_at: firstSyncStatus?.last_synced_at || null,
            sync_error: firstSyncStatus?.sync_error || null
          },
          pending_operations: outline.queue_items || []
        }
      })
    }
    
    // Single item response format
    if (outlineGuid && response.records.length === 1) {
      return new Response(
        JSON.stringify(response.records[0]),
        { status: 200, headers }
      )
    }
    
    // Return the formatted response
    return new Response(
      JSON.stringify(response),
      { status: 200, headers }
    )
    
  } catch (error) {
    console.error("Error in get-shopify-status:", error)
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers }
    )
  }
})