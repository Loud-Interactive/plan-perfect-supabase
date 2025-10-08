// supabase/functions/retry-outline-job/index.ts
// Manually retry a failed or stuck outline generation job

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { job_id, clear_previous_data } = await req.json();
    
    if (!job_id) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'job_id is required' 
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get current job details
    const { data: job, error: jobError } = await supabase
      .from('outline_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Job not found: ${jobError?.message || 'Unknown error'}` 
        }),
        { headers: corsHeaders, status: 404 }
      );
    }

    // Check if job can be retried
    if (job.status === 'completed') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cannot retry a completed job' 
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Optionally clear previous data if requested
    if (clear_previous_data) {
      console.log(`Clearing previous data for job ${job_id}`);
      
      // Clear search terms
      await supabase
        .from('outline_search_terms')
        .delete()
        .eq('job_id', job_id);
      
      // Clear search results
      await supabase
        .from('outline_search_results')
        .delete()
        .eq('job_id', job_id);
      
      // Clear URL analyses
      await supabase
        .from('outline_url_analyses')
        .delete()
        .eq('job_id', job_id);
      
      // Clear search queue
      await supabase
        .from('outline_search_queue')
        .delete()
        .eq('job_id', job_id);
      
      // Clear existing outline
      await supabase
        .from('content_plan_outlines_ai')
        .delete()
        .eq('job_id', job_id);
    }

    // Reset job status to pending with updated heartbeat
    const { error: resetError } = await supabase
      .from('outline_generation_jobs')
      .update({
        status: 'pending',
        error: null,
        updated_at: new Date().toISOString(),
        heartbeat: new Date().toISOString()
      })
      .eq('id', job_id);

    if (resetError) {
      console.error(`Failed to reset job ${job_id}:`, resetError.message);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Failed to reset job: ${resetError.message}` 
        }),
        { headers: corsHeaders, status: 500 }
      );
    }

    // Add retry status record
    await supabase
      .from('content_plan_outline_statuses')
      .insert({
        outline_guid: job_id,
        status: `manual_retry_initiated_${new Date().toISOString()}`
      });

    // Trigger reprocessing
    try {
      const retryResponse = await fetch(`${supabaseUrl}/functions/v1/process-outline-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({ job_id })
      });

      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        console.error(`Failed to trigger retry processing: ${retryResponse.status}, ${errorText}`);
        
        // Update status to indicate retry trigger failed
        await supabase
          .from('outline_generation_jobs')
          .update({ 
            status: 'retry_trigger_failed',
            error: `Failed to trigger retry: ${errorText}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);

        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Failed to trigger retry processing: ${errorText}` 
          }),
          { headers: corsHeaders, status: 500 }
        );
      }

      // Add success status
      await supabase
        .from('content_plan_outline_statuses')
        .insert({
          outline_guid: job_id,
          status: 'retry_processing_started'
        });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Job retry initiated successfully',
          job_id,
          cleared_previous_data: clear_previous_data || false
        }),
        { headers: corsHeaders }
      );

    } catch (triggerError) {
      console.error(`Error triggering retry for job ${job_id}:`, triggerError);
      
      // Update status to indicate trigger error
      await supabase
        .from('outline_generation_jobs')
        .update({ 
          status: 'retry_trigger_failed',
          error: `Retry trigger error: ${triggerError.message}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', job_id);

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Error triggering retry: ${triggerError.message}` 
        }),
        { headers: corsHeaders, status: 500 }
      );
    }

  } catch (error) {
    console.error('Error in retry-outline-job:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Internal server error: ${error.message}` 
      }),
      { headers: corsHeaders, status: 500 }
    );
  }
});