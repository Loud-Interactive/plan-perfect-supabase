// supabase/functions/update-plan-status/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface UpdatePlanStatusRequest {
  plan_guid: string;
  status: string;
}

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    // Parse request body
    const requestData: UpdatePlanStatusRequest = await req.json()
    
    // Validate required fields
    if (!requestData.plan_guid || !requestData.status) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: plan_guid and status are required' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json' 
          } 
        }
      )
    }

    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )

    console.log(`Updating status for plan_guid: ${requestData.plan_guid} to "${requestData.status}"`)

    // Insert new status record into content_plan_statuses table
    const { data, error } = await supabaseClient
      .from('content_plan_statuses')
      .insert({
        plan_guid: requestData.plan_guid,
        status: requestData.status,
        // timestamp will be set automatically by the database
      })
      .select()

    if (error) {
      console.error(`Error updating plan status: ${error.message}`)
      throw error
    }

    console.log(`Successfully updated status for plan_guid: ${requestData.plan_guid}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Status for plan ${requestData.plan_guid} updated to "${requestData.status}"`,
        data: data
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )

  } catch (error) {
    console.error(`Unhandled error: ${error.message}`)
    
    return new Response(
      JSON.stringify({ 
        error: `An unexpected error occurred: ${error.message}` 
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  }
})