// PagePerfect: get-crawl-jobs-batch
// Function to get status of a batch of crawl jobs
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get batchId from URL parameters
    const url = new URL(req.url);
    const batchId = url.searchParams.get('batchId');
    
    if (!batchId) {
      throw new Error('batchId is required as a query parameter');
    }
    
    // Get limit and page from URL parameters for pagination
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const page = parseInt(url.searchParams.get('page') || '0');
    const offset = page * limit;
    
    console.log(`Getting status for batch ${batchId} (limit: ${limit}, page: ${page})`);
    
    // Get all jobs in this batch
    const { data: jobs, error, count } = await supabaseClient
      .from('crawl_jobs')
      .select('*', { count: 'exact' })
      .eq('batch_id', batchId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
      
    if (error) {
      throw new Error(`Failed to fetch jobs: ${error.message}`);
    }
    
    // Get batch status counts
    const { data: statusCounts, error: countError } = await supabaseClient
      .from('crawl_jobs')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');
      
    if (countError) {
      throw new Error(`Failed to fetch status counts: ${countError.message}`);
    }
    
    // Format counts
    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0,
      total: count || 0
    };
    
    statusCounts.forEach(item => {
      counts[item.status] = item.count;
    });
    
    // Calculate overall status
    let batchStatus = 'pending';
    if (counts.error > 0 && counts.error === counts.total) {
      batchStatus = 'error';
    } else if (counts.completed === counts.total) {
      batchStatus = 'completed';
    } else if (counts.processing > 0 || counts.completed > 0) {
      batchStatus = 'processing';
    }
    
    // Calculate progress
    const progress = counts.total > 0 
      ? Math.round(((counts.completed + counts.error) / counts.total) * 100) 
      : 0;
    
    // Return response
    return new Response(
      JSON.stringify({
        success: true,
        batchId,
        status: batchStatus,
        progress,
        counts,
        totalPages: Math.ceil((count || 0) / limit),
        currentPage: page,
        jobs
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});