// supabase/functions/get-task-status-history/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { logError } from '../utils/error-handling.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/**
 * Function to get task status history
 * This function retrieves the status history for a task or outline
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get query parameters
    const url = new URL(req.url);
    const taskId = url.searchParams.get('task_id');
    const outlineGuid = url.searchParams.get('outline_guid');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    
    // Validate parameters
    if (!taskId && !outlineGuid) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Either task_id or outline_guid is required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    let query = supabase
      .from('task_status_history')
      .select('id, task_id, content_plan_outline_guid, status, previous_status, changed_at')
      .eq('is_deleted', false)
      .order('changed_at', { ascending: false })
      .limit(limit)
      .range(offset, offset + limit - 1);
    
    if (taskId) {
      query = query.eq('task_id', taskId);
    } else if (outlineGuid) {
      query = query.eq('content_plan_outline_guid', outlineGuid);
    }
    
    const { data, error, count } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch status history: ${error.message}`);
    }
    
    // Get total count for pagination
    const { count: totalCount, error: countError } = await supabase
      .from('task_status_history')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', false)
      .eq(taskId ? 'task_id' : 'content_plan_outline_guid', taskId || outlineGuid);
    
    if (countError) {
      console.warn(`Could not get exact count: ${countError.message}`);
    }
    
    // Get task or outline details
    let entityDetails = null;
    if (taskId) {
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('task_id, title, content_plan_outline_guid, created_at')
        .eq('task_id', taskId)
        .single();
      
      if (!taskError && taskData) {
        entityDetails = {
          type: 'task',
          ...taskData
        };
      }
    } else if (outlineGuid) {
      const { data: outlineData, error: outlineError } = await supabase
        .from('content_plan_outlines')
        .select('guid, keyword, title, created_at')
        .eq('guid', outlineGuid)
        .single();
      
      if (!outlineError && outlineData) {
        entityDetails = {
          type: 'outline',
          ...outlineData
        };
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        data,
        entity: entityDetails,
        pagination: {
          offset,
          limit,
          total: totalCount || 'unknown'
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    // Log the error
    await logError('get-task-status-history', null, error as Error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: (error as Error).message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});