// supabase/functions/post-outline/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { v4 as uuidv4 } from 'https://esm.sh/uuid@9.0.0'

interface OutlineRequest {
  content_plan_guid: string;
  post_title: string;
  client_name: string;
  client_domain: string;
  outline_details: any; // JSON object with outline details
}

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const requestData: OutlineRequest = await req.json()
    const { content_plan_guid, post_title, client_name, client_domain, outline_details } = requestData
    
    // Validate required fields
    if (!content_plan_guid || !post_title || !client_domain || !outline_details) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: content_plan_guid, post_title, client_domain, and outline_details are required" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`Processing outline request for post_title: ${post_title}, domain: ${client_domain}`)
    
    // Convert outline_details to string if it's an object
    const outline_json = typeof outline_details === 'string' 
      ? outline_details 
      : JSON.stringify(outline_details)
    
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )
    
    // Check if outline exists with the given parameters
    const { data: existingOutlines, error: findError } = await supabaseClient
      .from('content_plan_outlines')
      .select('guid')
      .eq('content_plan_guid', content_plan_guid)
      .eq('post_title', post_title)
      .eq('domain', client_domain)
      .not('is_deleted', 'is', true) // Filter out soft-deleted records
    
    if (findError) {
      console.error(`Error checking for existing outline: ${findError.message}`)
      throw findError
    }
    
    let message: string
    let guid: string
    
    if (existingOutlines && existingOutlines.length > 0) {
      // Update existing outline(s)
      guid = existingOutlines[0].guid
      console.log(`Updating existing outline with guid: ${guid}`)
      
      const { data: updateData, error: updateError } = await supabaseClient
        .from('content_plan_outlines')
        .update({
          outline: outline_json,
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('guid', guid)
        .select()
      
      if (updateError) {
        console.error(`Error updating outline: ${updateError.message}`)
        throw updateError
      }
      
      message = 'Outline updated successfully'
    } else {
      // Create new outline record
      guid = uuidv4()
      console.log(`Creating new outline with guid: ${guid}`)
      
      const { data: insertData, error: insertError } = await supabaseClient
        .from('content_plan_outlines')
        .insert({
          guid,
          content_plan_guid,
          post_title,
          domain: client_domain,
          status: 'completed',
          outline: outline_json,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
      
      if (insertError) {
        console.error(`Error inserting outline: ${insertError.message}`)
        throw insertError
      }
      
      message = 'Outline created successfully'
    }
    
    // Prepare response
    const response = {
      guid,
      post_title,
      client_name,
      client_domain,
      json: outline_details,
      message
    }
    
    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("Error in outline processing:", error)
    
    return new Response(
      JSON.stringify({ error: `Outline processing failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})