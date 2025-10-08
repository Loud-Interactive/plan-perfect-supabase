// supabase/functions/get-schema/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key for admin rights
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // Get outline GUID from query params if it's a GET request
    // or from request body if it's a POST request
    let outlineGuid: string;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      outlineGuid = url.searchParams.get('guid') || '';
      
      if (!outlineGuid) {
        return new Response(
          JSON.stringify({ error: 'Missing required parameter: guid' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    } else if (req.method === 'POST') {
      const { guid } = await req.json();
      outlineGuid = guid;
      
      if (!outlineGuid) {
        return new Response(
          JSON.stringify({ error: 'Missing required parameter: guid' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Fetching schema data for outline GUID: ${outlineGuid}`);

    // Query the database for schema_data
    const { data, error } = await supabaseClient
      .from('content_plan_outlines')
      .select('guid, schema_data, post_title')
      .eq('guid', outlineGuid)
      .single();

    if (error) {
      console.error('Database query error:', error);
      return new Response(
        JSON.stringify({ error: `Failed to retrieve schema: ${error.message}` }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'Outline not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Return schema data or a message if it's missing
    if (!data.schema_data) {
      return new Response(
        JSON.stringify({ 
          guid: data.guid, 
          post_title: data.post_title,
          message: 'No schema data available for this outline',
          schema_data: null
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        guid: data.guid, 
        post_title: data.post_title,
        schema_data: data.schema_data 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in get-schema function:', error);
    
    return new Response(
      JSON.stringify({ error: `Failed to retrieve schema: ${error.message}` }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});