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
    const { batchId } = await req.json();
    
    console.log('=== Simple Worker Test ===');
    console.log('Batch ID:', batchId);
    
    // Step 1: Count available jobs
    const { count, error: countError } = await supabase
      .from('page_seo_queue')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId || 'minimal-test')
      .is('locked_by', null)
      .is('completed_at', null);
    
    console.log('Count result:', count, 'Error:', countError);
    
    // Step 2: Get one job
    const { data: jobs, error: selectError } = await supabase
      .from('page_seo_queue')
      .select('*')
      .eq('batch_id', batchId || 'minimal-test')
      .is('locked_by', null)
      .is('completed_at', null)
      .limit(1);
    
    console.log('Select result:', jobs?.length, 'jobs, Error:', selectError);
    
    if (jobs && jobs.length > 0) {
      console.log('Sample job:', jobs[0]);
      
      // Step 3: Try to lock the job
      const { data: lockedJobs, error: lockError } = await supabase
        .from('page_seo_queue')
        .update({
          locked_by: 'simple-test-worker',
          locked_until: new Date(Date.now() + 300000).toISOString(),
          locked_at: new Date().toISOString()
        })
        .eq('id', jobs[0].id)
        .is('locked_by', null)
        .select();
      
      console.log('Lock result:', lockedJobs?.length, 'jobs locked, Error:', lockError);
      
      if (lockedJobs && lockedJobs.length > 0) {
        // Success! Release the lock
        await supabase
          .from('page_seo_queue')
          .update({
            locked_by: null,
            locked_until: null,
            locked_at: null
          })
          .eq('id', jobs[0].id);
        
        console.log('Successfully tested locking mechanism!');
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        availableJobs: count,
        selectedJobs: jobs?.length || 0,
        countError: countError?.message,
        selectError: selectError?.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in simple worker test:', error);
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