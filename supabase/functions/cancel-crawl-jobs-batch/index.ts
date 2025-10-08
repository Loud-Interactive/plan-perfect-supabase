// PagePerfect: cancel-crawl-jobs-batch
// Function to cancel a batch of crawl jobs
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  batchId: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }
  
  try {
    const { batchId } = await req.json() as RequestBody;
    
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

    // 1. First get a count of jobs in this batch that can be cancelled
    const { data: countData, error: countError } = await supabaseClient
      .from('crawl_jobs')
      .select('status', { count: 'exact' })
      .eq('batch_id', batchId)
      .in('status', ['pending', 'processing']);

    if (countError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to count jobs', details: countError }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    const count = countData?.length || 0;
    
    // If no cancellable jobs, return early
    if (count === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          count: 0, 
          message: 'No pending or processing jobs found in this batch' 
        }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    // 2. Cancel the jobs by updating their status to 'cancelled'
    const { data: updateData, error: updateError } = await supabaseClient
      .from('crawl_jobs')
      .update({
        status: 'cancelled',
        error: 'Manually cancelled by user',
        updated_at: new Date().toISOString()
      })
      .eq('batch_id', batchId)
      .in('status', ['pending', 'processing']);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to cancel jobs', details: updateError }),
        { 
          status: 500, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    // 3. Get updated batch status
    const { data: batchStatus, error: statusError } = await supabaseClient
      .from('crawl_jobs')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');

    if (statusError) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          count, 
          message: `Cancelled ${count} jobs in batch ${batchId}`,
          error: 'Failed to get updated batch status'
        }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          }
        }
      );
    }

    // Format the status counts
    const statusCounts = {
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0,
      cancelled: 0
    };

    batchStatus.forEach(item => {
      const status = item.status as keyof typeof statusCounts;
      if (status in statusCounts) {
        statusCounts[status] = parseInt(item.count);
      }
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        count, 
        message: `Cancelled ${count} jobs in batch ${batchId}`,
        statusCounts
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