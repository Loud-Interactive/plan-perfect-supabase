import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestData = await req.json();
    const { content_plan_outline_guid, live_post_url } = requestData;
    
    if (!content_plan_outline_guid) {
      return new Response(
        JSON.stringify({ error: 'content_plan_outline_guid is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // live_post_url is allowed to be null or empty to clear the URL
    // Convert empty string to null for database consistency
    const processedUrl = live_post_url === '' ? null : live_post_url;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the task associated with the content_plan_outline_guid
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('task_id')
      .eq('content_plan_outline_guid', content_plan_outline_guid)
      .order('created_at', { ascending: false })
      .limit(1);

    if (taskError || !taskData || taskData.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: `Task not found for the given content_plan_outline_guid: ${taskError?.message || 'No matching task found'}` 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const task_id = taskData[0].task_id;
    const now = new Date().toISOString();
    
    // Update the live_post_url and last_updated_at fields
    const { data: updatedTask, error: updateError } = await supabase
      .from('tasks')
      .update({ 
        live_post_url: processedUrl, 
        last_updated_at: now 
      })
      .eq('task_id', task_id)
      .select();

    if (updateError) {
      return new Response(
        JSON.stringify({ error: `Failed to update task: ${updateError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
      
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Live post URL updated successfully', 
        task_id, 
        updated_url: processedUrl 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing update live post URL request:', error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});