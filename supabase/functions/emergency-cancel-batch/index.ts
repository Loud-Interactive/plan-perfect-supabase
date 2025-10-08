// PagePerfect: emergency-cancel-batch
// Emergency function to cancel a specific batch (batch-1746402119160)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Default batch ID to cancel
const TARGET_BATCH_ID = "batch-1746402119160";

serve(async (req) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Get batch ID from URL or use default
    const url = new URL(req.url);
    const batchId = url.searchParams.get('batchId') || TARGET_BATCH_ID;

    console.log(`🚨 EMERGENCY: Cancelling batch ${batchId}`);

    // First, check status of the batch
    const { data: statusBefore, error: statusError } = await supabaseClient
      .from('crawl_jobs')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');

    if (statusError) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to get batch status', 
          details: statusError 
        }),
        { status: 500, headers }
      );
    }

    // Count jobs that can be cancelled (pending or processing)
    let cancelableCount = 0;
    if (statusBefore) {
      for (const item of statusBefore) {
        if (item.status === 'pending' || item.status === 'processing') {
          cancelableCount += parseInt(item.count);
        }
      }
    }

    // If no cancelable jobs, return early
    if (cancelableCount === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No pending or processing jobs to cancel', 
          batchId,
          statusBefore 
        }),
        { status: 200, headers }
      );
    }

    // Cancel all pending and processing jobs
    const { data: updateResult, error: updateError } = await supabaseClient
      .from('crawl_jobs')
      .update({
        status: 'cancelled',
        error: 'EMERGENCY CANCELLATION',
        updated_at: new Date().toISOString()
      })
      .eq('batch_id', batchId)
      .in('status', ['pending', 'processing']);

    if (updateError) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to cancel jobs', 
          details: updateError 
        }),
        { status: 500, headers }
      );
    }

    // Get updated status
    const { data: statusAfter, error: afterError } = await supabaseClient
      .from('crawl_jobs')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');

    // Format counts for easier reading
    const countsBefore = {};
    const countsAfter = {};
    
    if (statusBefore) {
      for (const item of statusBefore) {
        countsBefore[item.status] = parseInt(item.count);
      }
    }
    
    if (statusAfter) {
      for (const item of statusAfter) {
        countsAfter[item.status] = parseInt(item.count);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully cancelled ${cancelableCount} jobs in batch ${batchId}`,
        batchId,
        countsBefore,
        countsAfter
      }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error('Emergency cancellation error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Unexpected error during emergency cancellation', 
        details: error.message,
        stack: error.stack
      }),
      { status: 500, headers }
    );
  }
});