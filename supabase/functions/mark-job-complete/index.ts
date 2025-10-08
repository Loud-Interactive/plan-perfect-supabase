// mark-job-complete
// A utility function to mark a GSC job as completed without processing

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Parse request body
    const { jobId, message = 'Marked as completed without processing' } = await req.json();
    
    if (!jobId) {
      throw new Error('jobId is required');
    }
    
    console.log(`Marking job ${jobId} as completed without processing`);
    
    // First, add a log entry
    await supabaseClient
      .from('gsc_job_logs')
      .insert({
        job_id: jobId,
        log_type: 'info',
        message: message
      });
    
    // Update job status to completed
    const { data, error } = await supabaseClient
      .from('gsc_job_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        rows_processed: 0,
        last_heartbeat: new Date().toISOString()
      })
      .eq('id', jobId);
      
    if (error) {
      throw new Error(`Failed to update job: ${error.message}`);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Job ${jobId} marked as completed`,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});