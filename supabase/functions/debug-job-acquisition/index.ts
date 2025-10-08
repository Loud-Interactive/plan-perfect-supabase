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
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request = await req.json();
    const { batchId } = request;
    
    console.log('=== Debug Job Acquisition ===');
    console.log('SUPABASE_URL:', supabaseUrl);
    console.log('Service Key Length:', supabaseServiceKey?.length);
    console.log('Batch ID:', batchId);
    
    // Step 1: Check all jobs in the table
    const { data: allJobs, error: allError } = await supabase
      .from('page_seo_queue')
      .select('id, batch_id, status, locked_by, page_url')
      .limit(10);
    
    console.log('All jobs:', allJobs);
    console.log('All jobs error:', allError);
    
    // Step 2: Check jobs with status = 'pending'
    let query = supabase
      .from('page_seo_queue')
      .select('id, batch_id, status, locked_by, page_url')
      .eq('status', 'pending');
    
    if (batchId) {
      query = query.eq('batch_id', batchId);
    }
    
    const { data: pendingJobs, error: pendingError } = await query.limit(10);
    
    console.log('Pending jobs:', pendingJobs);
    console.log('Pending jobs error:', pendingError);
    
    // Step 3: Check jobs that are unlocked
    let unlockedQuery = supabase
      .from('page_seo_queue')
      .select('id, batch_id, status, locked_by, page_url')
      .eq('status', 'pending')
      .is('locked_by', null);
    
    if (batchId) {
      unlockedQuery = unlockedQuery.eq('batch_id', batchId);
    }
    
    const { data: unlockedJobs, error: unlockedError } = await unlockedQuery.limit(10);
    
    console.log('Unlocked jobs:', unlockedJobs);
    console.log('Unlocked jobs error:', unlockedError);
    
    // Step 4: Try to lock one job
    if (unlockedJobs && unlockedJobs.length > 0) {
      const jobToLock = unlockedJobs[0];
      
      const { data: lockedJob, error: lockError } = await supabase
        .from('page_seo_queue')
        .update({
          status: 'processing',
          locked_by: 'debug-test',
          locked_until: new Date(Date.now() + 300000).toISOString(),
          started_at: new Date().toISOString()
        })
        .eq('id', jobToLock.id)
        .eq('status', 'pending')
        .is('locked_by', null)
        .select();
      
      console.log('Lock attempt result:', lockedJob);
      console.log('Lock attempt error:', lockError);
      
      return new Response(
        JSON.stringify({
          success: true,
          allJobs: allJobs?.length || 0,
          pendingJobs: pendingJobs?.length || 0,
          unlockedJobs: unlockedJobs?.length || 0,
          lockAttempt: {
            success: !lockError && lockedJob && lockedJob.length > 0,
            lockedCount: lockedJob?.length || 0,
            error: lockError?.message
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    } else {
      return new Response(
        JSON.stringify({
          success: true,
          allJobs: allJobs?.length || 0,
          pendingJobs: pendingJobs?.length || 0,
          unlockedJobs: unlockedJobs?.length || 0,
          lockAttempt: { success: false, reason: 'No unlocked jobs found' }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

  } catch (error) {
    console.error('Error in debug function:', error);
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