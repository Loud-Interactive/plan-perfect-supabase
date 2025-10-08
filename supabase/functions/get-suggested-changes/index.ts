// supabase/functions/get-suggested-changes/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'

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
    const { version_id } = await req.json()
    
    if (!version_id) {
      return new Response(JSON.stringify({ error: 'Version ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Getting suggested changes for version ID: ${version_id}`)
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get the suggested changes
    const { data: changes, error: changesError } = await supabase
      .from('suggested_changes')
      .select('*')
      .eq('version_id', version_id)
      .eq('is_deleted', false)
      .order('id');
    
    if (changesError) {
      console.error('Error fetching suggested changes:', changesError);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch suggested changes: ${changesError.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Retrieved ${changes?.length || 0} suggested changes`);
    
    // Return the suggested changes
    return new Response(JSON.stringify({ 
      success: true,
      changes: changes || []
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in get-suggested-changes function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to retrieve suggested changes: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
})