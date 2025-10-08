import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('=== Simple Test (Identical Copy) ===');
    
    // Check available jobs
    const { count: availableCount, error: countError } = await supabase
      .from('page_seo_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .is('locked_by', null);

    if (countError) {
      throw new Error(`Count error: ${countError.message}`);
    }

    console.log(`Available jobs: ${availableCount}`);

    if (!availableCount || availableCount === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          availableJobs: 0,
          selectedJobs: 0,
          message: 'No jobs available'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Get one job to lock
    const { data: jobs, error: selectError } = await supabase
      .from('page_seo_queue')
      .select('*')
      .eq('status', 'pending')
      .is('locked_by', null)
      .limit(1);

    if (selectError || !jobs || jobs.length === 0) {
      throw new Error(`Select error: ${selectError?.message || 'No jobs found'}`);
    }

    console.log(`Selected jobs: ${jobs.length}`);
    
    // Try to lock the job
    const jobToLock = jobs[0];
    const lockUntil = new Date(Date.now() + 300000).toISOString(); // 5 minutes
    
    const { data: lockedJob, error: lockError } = await supabase
      .from('page_seo_queue')
      .update({
        status: 'processing',
        locked_by: 'identical-test',
        locked_until: lockUntil,
        started_at: new Date().toISOString()
      })
      .eq('id', jobToLock.id)
      .eq('status', 'pending')
      .is('locked_by', null)
      .select();

    if (lockError) {
      throw new Error(`Lock error: ${lockError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        availableJobs: availableCount,
        selectedJobs: jobs.length,
        lockedJobs: lockedJob?.length || 0,
        jobId: jobToLock.id
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in identical simple test:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});