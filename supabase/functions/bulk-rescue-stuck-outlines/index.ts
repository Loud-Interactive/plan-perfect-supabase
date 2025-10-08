// Supabase Edge Function: bulk-rescue-stuck-outlines
// Rescues stuck outline and content generation jobs in bulk

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Standard CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json'
};

// Helper function to create standard response format
function createResponse(success: boolean, message: string, data?: any) {
  return {
    success,
    message,
    ...(data && { data }),
    timestamp: new Date().toISOString()
  };
}

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
    const { 
      job_type = 'outline',
      min_age_minutes = 30,
      max_jobs = 10
    } = requestData;
    
    if (!['outline', 'content'].includes(job_type)) {
      return new Response(
        JSON.stringify(createResponse(false, 'Invalid job_type. Must be "outline" or "content"')),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Calculate stale timestamp
    const staleTime = new Date();
    staleTime.setMinutes(staleTime.getMinutes() - min_age_minutes);
    const staleTimeStr = staleTime.toISOString();

    let rescuedJobs = [];

    if (job_type === 'outline') {
      // Find stuck outline jobs
      const { data: stuckJobs, error: findError } = await supabase
        .from('outline_generation_jobs')
        .select('id, status')
        .lt('heartbeat', staleTimeStr)
        .not('status', 'in', ['completed', 'failed'])
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(max_jobs);
      
      if (findError) {
        console.error('Failed to find stuck outline jobs:', findError.message);
        return new Response(
          JSON.stringify(createResponse(false, 'Failed to find stuck outline jobs')),
          { headers: corsHeaders, status: 500 }
        );
      }

      // Rescue each stuck job
      for (const job of stuckJobs || []) {
        try {
          // Reset job status
          const { error: resetError } = await supabase
            .from('outline_generation_jobs')
            .update({
              status: 'pending',
              error: null,
              updated_at: new Date().toISOString(),
              heartbeat: new Date().toISOString()
            })
            .eq('id', job.id);
          
          if (resetError) {
            console.error(`Failed to reset outline job ${job.id}:`, resetError.message);
            continue;
          }

          // Trigger reprocessing
          try {
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-outline-job`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
              },
              body: JSON.stringify({ job_id: job.id })
            })
            .catch(error => {
              console.error(`Error triggering process-outline-job for ${job.id}:`, error);
            });
          } catch (triggerError) {
            console.error(`Exception when triggering process-outline-job for ${job.id}:`, triggerError);
          }

          rescuedJobs.push(job.id);
        } catch (jobError) {
          console.error(`Error rescuing outline job ${job.id}:`, jobError);
        }
      }
    } else if (job_type === 'content') {
      // Find stuck content jobs
      const { data: stuckJobs, error: findError } = await supabase
        .from('content_generation_jobs')
        .select('id, status')
        .lt('heartbeat', staleTimeStr)
        .not('status', 'in', ['completed', 'failed'])
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(max_jobs);
      
      if (findError) {
        console.error('Failed to find stuck content jobs:', findError.message);
        return new Response(
          JSON.stringify(createResponse(false, 'Failed to find stuck content jobs')),
          { headers: corsHeaders, status: 500 }
        );
      }

      // Rescue each stuck job
      for (const job of stuckJobs || []) {
        try {
          // Determine reset status based on current state
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
            .eq('id', job.id);
          
          if (resetError) {
            console.error(`Failed to reset content job ${job.id}:`, resetError.message);
            continue;
          }

          // If job is in processing or research status, reset sections
          if (resetTo === 'processing' || resetTo === 'research') {
            // Get sections in processing or research status
            const { data: sections, error: sectionsError } = await supabase
              .from('content_sections')
              .select('id')
              .eq('job_id', job.id)
              .in('status', ['processing', 'research'])
              .eq('is_deleted', false);
            
            if (!sectionsError && sections && sections.length > 0) {
              const sectionIds = sections.map(s => s.id);
              
              // Reset sections to pending
              const { error: sectionResetError } = await supabase
                .from('content_sections')
                .update({
                  status: 'pending',
                  updated_at: new Date().toISOString()
                })
                .in('id', sectionIds);
              
              if (sectionResetError) {
                console.error(`Failed to reset sections for job ${job.id}:`, sectionResetError.message);
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
              .eq('job_id', job.id)
              .neq('status', 'completed');
            
            if (queueResetError) {
              console.error(`Failed to reset queue entries for job ${job.id}:`, queueResetError.message);
            }
          }

          // Trigger reprocessing
          try {
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-content-job`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
              },
              body: JSON.stringify({ job_id: job.id })
            })
            .catch(error => {
              console.error(`Error triggering process-content-job for ${job.id}:`, error);
            });
          } catch (triggerError) {
            console.error(`Exception when triggering process-content-job for ${job.id}:`, triggerError);
          }

          rescuedJobs.push(job.id);
        } catch (jobError) {
          console.error(`Error rescuing content job ${job.id}:`, jobError);
        }
      }
    }

    return new Response(
      JSON.stringify(createResponse(true, 'Successfully rescued stuck jobs', {
        job_type,
        rescued_jobs: rescuedJobs.length,
        job_ids: rescuedJobs
      })),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error('Internal server error:', error);
    
    return new Response(
      JSON.stringify(createResponse(false, 'Internal server error')),
      { headers: corsHeaders, status: 500 }
    );
  }
});