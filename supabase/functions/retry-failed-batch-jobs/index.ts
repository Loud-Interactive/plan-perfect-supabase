import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }
  
  try {
    const { batchId } = await req.json();
    
    if (!batchId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Batch ID is required' }),
        { 
          status: 400, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // 1. Find all failed jobs for this batch
    const { data: failedJobs, error: findError } = await supabaseClient
      .from('crawl_jobs')
      .select('id')
      .eq('batch_id', batchId)
      .eq('status', 'error');

    if (findError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to find failed jobs', details: findError }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    // If no failed jobs, return early
    if (!failedJobs || failedJobs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, count: 0, message: 'No failed jobs found for this batch' }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    // 2. Fetch jobs with current retry counts
    const { data: jobsWithCounts, error: countError } = await supabaseClient
      .from('crawl_jobs')
      .select('id, retry_count')
      .in('id', failedJobs.map(job => job.id));
      
    if (countError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch retry counts', details: countError }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }
    
    // 3. Reset the failed jobs to pending status
    const jobIds = failedJobs.map(job => job.id);
    
    // Process updates for each job individually to increment retry counts correctly
    let failedUpdates = 0;
    let successfulUpdates = 0;
    
    for (const job of jobsWithCounts) {
      const currentRetryCount = job.retry_count || 0;
      const { error: updateError } = await supabaseClient
        .from('crawl_jobs')
        .update({
          status: 'pending',
          error: null,
          retry_count: currentRetryCount + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
        
      if (updateError) {
        failedUpdates++;
        console.error(`Failed to update job ${job.id}:`, updateError);
      } else {
        successfulUpdates++;
      }
    }
    
    if (failedUpdates > 0 && successfulUpdates === 0) {
      return new Response(
        JSON.stringify({ success: false, error: `Failed to reset all ${failedUpdates} jobs` }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: successfulUpdates,
        failedCount: failedUpdates,
        message: `Reset ${successfulUpdates} failed jobs to pending status${failedUpdates > 0 ? ` (${failedUpdates} failed)` : ''}`
      }),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders 
        }
      }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Unexpected error occurred', details: error.message }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders 
        }
      }
    );
  }
});