// supabase/functions/update-task-status/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { logError } from '../utils/error-handling.ts';
import { triggerCentrWebhooks } from '../_shared/webhook-helpers-v2.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/**
 * Function to update task status
 * This function updates the task status and relies on the database trigger
 * to record the status change in the task_status_history table
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const requestData = await req.json();
    const { task_id, content_plan_outline_guid, status, additional_data } = requestData;
    
    // Validate required fields
    if (!task_id && !content_plan_outline_guid) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Either task_id or content_plan_outline_guid is required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    if (!status) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Status is required' 
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    let updateData: Record<string, any> = {
      status,
      last_updated_at: new Date().toISOString()
    };
    
    // Add any additional data to the update
    if (additional_data && typeof additional_data === 'object') {
      updateData = { ...updateData, ...additional_data };
    }
    
    // Update the task - either by task_id or by content_plan_outline_guid
    if (task_id) {
      // Get outline_guid first for logging purposes
      const { data: taskData, error: taskInfoError } = await supabase
        .from('tasks')
        .select('content_plan_outline_guid')
        .eq('task_id', task_id)
        .single();
      
      if (taskInfoError) {
        console.warn(`Warning: Could not retrieve outline GUID: ${taskInfoError.message}`);
      }
      
      const outlineGuid = taskData?.content_plan_outline_guid || null;
      
      // Update the task
      const { data, error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('task_id', task_id)
        .select();
      
      if (error) {
        throw new Error(`Failed to update task: ${error.message}`);
      }
      
      // Manually log the status change in case the trigger doesn't work
      try {
        if (outlineGuid) {
          await supabase
            .from('task_status_history')
            .insert({
              task_id,
              content_plan_outline_guid: outlineGuid,
              status,
              previous_status: null, // We don't know the previous status here
              changed_at: new Date().toISOString()
            });
        }
      } catch (historyError) {
        console.warn(`Warning: Could not log status history: ${historyError}`);
      }
      
      // Send Centr webhook notification for status change
      try {
        console.log(`[Webhook] Sending Centr webhook for task ${task_id}, status: ${status}`);
        
        // Prepare full task data for Centr webhook format
        const webhookData = {
          task_id: task_id,
          title: data[0]?.title || '',
          slug: data[0]?.title ? data[0].title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-') : '',
          status: status,
          client_domain: data[0]?.client_domain || '',
          content: data[0]?.content || data[0]?.post_html || '',
          html_link: data[0]?.html_link,
          google_doc_link: data[0]?.google_doc_link,
          live_post_url: data[0]?.live_post_url,
          seo_keyword: data[0]?.seo_keyword,
          meta_description: data[0]?.meta_description,
          hero_image_url: data[0]?.hero_image_url,
          completed_at: new Date().toISOString(),
          error: null,
          ...additional_data
        };
        
        // Determine event type based on status
        let eventType = 'content_complete';
        const normalizedStatus = status.toLowerCase();
        if (normalizedStatus === 'completed' || normalizedStatus === 'complete') {
          eventType = 'content_complete';
        } else if (normalizedStatus === 'started' || normalizedStatus === 'processing') {
          eventType = 'content_started';
        } else if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
          eventType = 'content_error';
        }
        
        await triggerCentrWebhooks(supabase, eventType, webhookData, task_id);
        console.log(`[Webhook] ✅ Centr webhook sent for status: ${status}`);
      } catch (webhookError) {
        console.error('[Webhook] Failed to send Centr webhook:', webhookError);
        // Don't fail the function if webhook fails
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Task status updated successfully',
          data
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    } else {
      // If using content_plan_outline_guid, get latest task
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('task_id')
        .eq('content_plan_outline_guid', content_plan_outline_guid)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (taskError || !taskData || taskData.length === 0) {
        throw new Error(`Task not found for outline GUID: ${content_plan_outline_guid}`);
      }
      
      const latestTaskId = taskData[0].task_id;
      
      // Get current status for history logging
      const { data: currentTask, error: currentTaskError } = await supabase
        .from('tasks')
        .select('status')
        .eq('task_id', latestTaskId)
        .single();
      
      const previousStatus = currentTaskError ? null : currentTask?.status;
      
      // Update the task
      const { data, error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('task_id', latestTaskId)
        .select();
      
      if (error) {
        throw new Error(`Failed to update task: ${error.message}`);
      }
      
      // Manually log the status change in case the trigger doesn't work
      try {
        await supabase
          .from('task_status_history')
          .insert({
            task_id: latestTaskId,
            content_plan_outline_guid,
            status,
            previous_status: previousStatus,
            changed_at: new Date().toISOString()
          });
      } catch (historyError) {
        console.warn(`Warning: Could not log status history: ${historyError}`);
      }
      
      // Send Centr webhook notification for status change
      try {
        console.log(`[Webhook] Sending Centr webhook for task ${latestTaskId}, status: ${status}`);
        
        // Prepare full task data for Centr webhook format
        const webhookData = {
          task_id: latestTaskId,
          title: data[0]?.title || '',
          slug: data[0]?.title ? data[0].title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-') : '',
          status: status,
          client_domain: data[0]?.client_domain || '',
          content: data[0]?.content || data[0]?.post_html || '',
          html_link: data[0]?.html_link,
          google_doc_link: data[0]?.google_doc_link,
          live_post_url: data[0]?.live_post_url,
          seo_keyword: data[0]?.seo_keyword,
          meta_description: data[0]?.meta_description,
          hero_image_url: data[0]?.hero_image_url,
          completed_at: new Date().toISOString(),
          error: null,
          ...additional_data
        };
        
        // Determine event type based on status
        let eventType = 'content_complete';
        const normalizedStatus = status.toLowerCase();
        if (normalizedStatus === 'completed' || normalizedStatus === 'complete') {
          eventType = 'content_complete';
        } else if (normalizedStatus === 'started' || normalizedStatus === 'processing') {
          eventType = 'content_started';
        } else if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
          eventType = 'content_error';
        }
        
        await triggerCentrWebhooks(supabase, eventType, webhookData, latestTaskId);
        console.log(`[Webhook] ✅ Centr webhook sent for status: ${status}`);
      } catch (webhookError) {
        console.error('[Webhook] Failed to send Centr webhook:', webhookError);
        // Don't fail the function if webhook fails
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Task status updated successfully',
          data
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
  } catch (error) {
    // Log the error
    await logError('update-task-status', null, error as Error);
    
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