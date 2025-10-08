// Supabase Edge Function: reset-stuck-content-job
// Resets a stuck content generation job for reprocessing

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../helpers.ts';
import { 
  handleError, 
  createResponse
} from '../content-perfect/utils/index.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body
    const requestData = await req.json();
    const { job_id } = requestData;
    
    if (!job_id) {
      return new Response(
        JSON.stringify(createResponse(false, 'Missing required parameter: job_id')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('is_deleted', false)
      .single();
    
    if (jobError) {
      await handleError(supabase, jobError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Job not found')),
        { headers: { ...corsHeaders }, status: 404 }
      );
    }

    // Check if job is already completed
    if (job.status === 'completed') {
      return new Response(
        JSON.stringify(createResponse(false, 'Cannot reset a completed job')),
        { headers: { ...corsHeaders }, status: 400 }
      );
    }

    // Determine the reset strategy based on job status
    let resetTo = 'pending';
    
    if (job.status === 'converting') {
      resetTo = 'converting';
    } else if (job.status === 'assembling') {
      resetTo = 'assembling';
    } else if (job.status === 'processing') {
      resetTo = 'processing';
    } else if (job.status === 'research') {
      resetTo = 'research';
    }

    // Reset job status
    const { error: resetError } = await supabase
      .from('content_generation_jobs')
      .update({ 
        status: resetTo,
        error: null,
        updated_at: new Date().toISOString(),
        heartbeat: new Date().toISOString()
      })
      .eq('id', job_id);
    
    if (resetError) {
      await handleError(supabase, resetError, { job_id });
      return new Response(
        JSON.stringify(createResponse(false, 'Failed to reset job status')),
        { headers: { ...corsHeaders }, status: 500 }
      );
    }

    // If we're resetting a job in processing or research status,
    // check for sections that may be stuck
    if (resetTo === 'processing' || resetTo === 'research') {
      // Get all sections for this job
      const { data: sections, error: sectionsError } = await supabase
        .from('content_sections')
        .select('*')
        .eq('job_id', job_id)
        .eq('is_deleted', false);
      
      if (sectionsError) {
        await handleError(supabase, sectionsError, { job_id });
        console.error('Failed to retrieve sections:', sectionsError.message);
      } else {
        // Reset any processing or research sections to pending
        const sectionIdsToReset = sections
          .filter(s => s.status === 'processing' || s.status === 'research')
          .map(s => s.id);
        
        if (sectionIdsToReset.length > 0) {
          const { error: sectionResetError } = await supabase
            .from('content_sections')
            .update({ 
              status: 'pending',
              updated_at: new Date().toISOString()
            })
            .in('id', sectionIdsToReset);
          
          if (sectionResetError) {
            await handleError(supabase, sectionResetError, { job_id, section_ids: sectionIdsToReset });
            console.error('Failed to reset section status:', sectionResetError.message);
          }
        }

        // Reset queue entries
        const { error: queueResetError } = await supabase
          .from('content_section_queue')
          .update({ 
            status: 'pending',
            attempts: 0,
            updated_at: new Date().toISOString(),
            next_attempt_at: new Date().toISOString()
          })
          .eq('job_id', job_id)
          .neq('status', 'completed');
        
        if (queueResetError) {
          await handleError(supabase, queueResetError, { job_id });
          console.error('Failed to reset queue entries:', queueResetError.message);
        }
      }
    }

    // Trigger job processing
    try {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-content-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        },
        body: JSON.stringify({ job_id })
      })
      .catch(error => {
        console.error('Error triggering process-content-job:', error);
      });
    } catch (error) {
      console.error('Exception when triggering process-content-job:', error);
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Job reset successfully', {
        job_id,
        reset_to: resetTo,
        previous_status: job.status
      })),
      { headers: { ...corsHeaders } }
    );

  } catch (error) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await handleError(supabase, error, { path: 'reset-stuck-content-job' });
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: { ...corsHeaders }, status: 500 }
    );
  }
});