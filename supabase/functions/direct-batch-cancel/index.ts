// PagePerfect: direct-batch-cancel
// Simple function to cancel a specific batch directly
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
    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Get the batch ID from the URL or request body
    let batchId = '';
    const url = new URL(req.url);
    const batchIdParam = url.searchParams.get('batchId');
    
    if (batchIdParam) {
      batchId = batchIdParam;
    } else {
      try {
        const body = await req.json();
        batchId = body.batchId || '';
      } catch (e) {
        // Failed to parse JSON, try URL params again
      }
    }
    
    // Fallback to a specific batch ID if none provided
    if (!batchId) {
      batchId = 'batch-1746402119160'; // The one mentioned by the user
    }
    
    console.log(`Attempting to cancel batch: ${batchId}`);
    
    // Cancel all pending and processing jobs in this batch
    const { data, error } = await supabaseClient
      .from('crawl_jobs')
      .update({
        status: 'cancelled',
        error: 'Manually cancelled by user via direct cancel function',
        updated_at: new Date().toISOString()
      })
      .eq('batch_id', batchId)
      .in('status', ['pending', 'processing']);
      
    if (error) {
      console.error('Error cancelling jobs:', error);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to cancel jobs',
          details: error
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
    
    // Get updated status after cancellation
    const { data: updatedStatus, error: statusError } = await supabaseClient
      .from('crawl_jobs')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');
      
    let statusReport = 'Status unknown';
    if (!statusError && updatedStatus) {
      statusReport = JSON.stringify(updatedStatus);
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Cancelled batch ${batchId}`,
        batchId,
        status: updatedStatus || []
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
      JSON.stringify({
        success: false,
        error: 'Unexpected error',
        details: error.message
      }),
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