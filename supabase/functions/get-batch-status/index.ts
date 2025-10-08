import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface RequestParams {
  batchId: string;
  limit?: number;
  offset?: number;
  status?: string;
}

interface ResponseData {
  success: boolean;
  batch?: any;
  urls?: any[];
  counts?: any;
  error?: string;
}

// Get Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get batch ID from URL
    const url = new URL(req.url);
    const batchId = url.searchParams.get('batchId');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status') || undefined;
    
    if (!batchId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Batch ID is required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }
    
    // Get batch information
    const { data: batchData, error: batchError } = await supabase
      .from('page_perfect_batches')
      .select('*')
      .eq('id', batchId)
      .single();
      
    if (batchError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Batch not found: ${batchError.message}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      )
    }
    
    // Get URLs for the batch with pagination and optional filtering
    let query = supabase
      .from('page_perfect_url_status')
      .select('id, url, status, errormessage, html_length, created_at, updated_at')
      .eq('batch_id', batchId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
      
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: urlsData, error: urlsError } = await query;
    
    if (urlsError) {
      throw new Error(`Failed to fetch URL status: ${urlsError.message}`);
    }
    
    // Get counts by status - using different approach without group
    const statuses = ['pending', 'processing', 'completed', 'error'];
    const counts = {
      pending: 0,
      processing: 0,
      completed: 0,
      error: 0,
      total: 0
    };
    
    // Get total count
    const { count: totalCount, error: totalError } = await supabase
      .from('page_perfect_url_status')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId);
      
    if (totalError) {
      throw new Error(`Failed to get total count: ${totalError.message}`);
    }
    
    counts.total = totalCount || 0;
    
    // Get counts for each status
    for (const status of statuses) {
      const { count, error: statusError } = await supabase
        .from('page_perfect_url_status')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', status);
        
      if (statusError) {
        console.error(`Error getting count for ${status}: ${statusError.message}`);
        continue;
      }
      
      counts[status] = count || 0;
    }
      
    // No need to check for countError as we handle errors for each query above
    
    // Now counts object is ready to be sent
    return new Response(
      JSON.stringify({
        success: true,
        batch: batchData,
        urls: urlsData,
        counts
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});