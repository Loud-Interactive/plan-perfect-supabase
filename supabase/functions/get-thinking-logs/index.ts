// supabase/functions/get-thinking-logs/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.4.0'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse URL to get query parameters
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    const versionId = url.searchParams.get('version_id');
    const promptType = url.searchParams.get('prompt_type');
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    
    if (!jobId && !versionId) {
      return new Response(JSON.stringify({ error: 'Either job_id or version_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Retrieving thinking logs for ${jobId ? 'job_id: ' + jobId : 'version_id: ' + versionId}${promptType ? ', prompt_type: ' + promptType : ''}`);
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Build the query
    let query = supabase
      .from('thinking_logs')
      .select('*')
      .eq('is_deleted', false)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    
    // Add filters based on provided parameters
    if (jobId) {
      query = query.eq('job_id', jobId);
    }
    
    if (versionId) {
      query = query.eq('version_id', versionId);
    }
    
    if (promptType) {
      query = query.eq('prompt_type', promptType);
    }
    
    // Execute the query
    const { data, error, count } = await query;
    
    if (error) {
      console.error('Error fetching thinking logs:', error);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch thinking logs: ${error.message}` 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Get the total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('thinking_logs')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', false)
      .eq(jobId ? 'job_id' : 'version_id', jobId || versionId);
    
    if (countError) {
      console.error('Error getting total count:', countError);
    }
    
    console.log(`Retrieved ${data?.length || 0} thinking logs`);
    
    // Return the thinking logs
    return new Response(JSON.stringify({ 
      success: true,
      logs: data || [],
      pagination: {
        offset,
        limit,
        total: totalCount || 0
      }
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Error in get-thinking-logs function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: `Failed to retrieve thinking logs: ${error.message}` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
})