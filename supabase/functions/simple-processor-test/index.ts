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
    const { workerId = 'simple-test', batchId = 'minimal-test' } = await req.json();
    
    console.log('=== Simple Processor Test ===');
    console.log('Worker ID:', workerId);
    console.log('Batch ID:', batchId);
    
    // Use EXACTLY the same query as the working simple test
    const { count, error: countError } = await supabase
      .from('page_seo_queue')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .is('locked_by', null)
      .is('completed_at', null);
    
    console.log('Count result:', count, 'Error:', countError);
    
    if (countError || !count || count === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          reason: 'No jobs available',
          count,
          error: countError?.message
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Get one job - EXACTLY like the working simple test
    const { data: jobs, error: selectError } = await supabase
      .from('page_seo_queue')
      .select('*')
      .eq('batch_id', batchId)
      .is('locked_by', null)
      .is('completed_at', null)
      .limit(1);
    
    console.log('Select result:', jobs?.length, 'jobs, Error:', selectError);
    
    if (selectError || !jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          reason: 'No jobs selected',
          error: selectError?.message
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const job = jobs[0];
    console.log('Processing job:', job.id, job.page_url);
    
    // Lock the job - EXACTLY like the working simple test
    const lockUntil = new Date(Date.now() + 300000).toISOString(); // 5 minutes
    const { data: lockedJob, error: lockError } = await supabase
      .from('page_seo_queue')
      .update({
        locked_by: workerId,
        locked_until: lockUntil,
        locked_at: new Date().toISOString()
      })
      .eq('id', job.id)
      .is('locked_by', null)
      .is('completed_at', null)
      .select();

    console.log('Lock result:', lockedJob?.length, 'jobs locked, Error:', lockError);
    
    if (lockError || !lockedJob || lockedJob.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          reason: 'Failed to lock job',
          error: lockError?.message
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Successfully acquired job - now process it
    console.log('Successfully locked job, processing...');
    
    try {
      // Call the SEO workflow
      const response = await fetch(`${supabaseUrl}/functions/v1/seo-direct-workflow-track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({
          pageId: job.page_id,
          url: job.page_url,
          forceRegenerate: false
        })
      });
      
      const responseText = await response.text();
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText.substring(0, 200)}`);
      }
      
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        throw new Error('Invalid JSON response');
      }
      
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }
      
      // Mark as completed
      await supabase
        .from('page_seo_queue')
        .update({
          completed_at: new Date().toISOString(),
          locked_by: null,
          locked_until: null,
          locked_at: null,
          error: null
        })
        .eq('id', job.id);
      
      console.log('Job completed successfully!');
      
      return new Response(
        JSON.stringify({
          success: true,
          processed: 1,
          jobId: job.id,
          url: job.page_url
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
      
    } catch (processingError) {
      // Mark as failed
      await supabase
        .from('page_seo_queue')
        .update({
          error: processingError.message,
          locked_by: null,
          locked_until: null,
          locked_at: null,
          retry_count: (job.retry_count || 0) + 1
        })
        .eq('id', job.id);
      
      console.log('Job failed:', processingError.message);
      
      return new Response(
        JSON.stringify({
          success: true,
          processed: 1,
          failed: 1,
          jobId: job.id,
          error: processingError.message
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

  } catch (error) {
    console.error('Error in simple processor test:', error);
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