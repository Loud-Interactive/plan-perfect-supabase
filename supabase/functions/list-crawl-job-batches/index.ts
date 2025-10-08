// PagePerfect: list-crawl-job-batches
// Function to list all batch jobs with statistics
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

interface BatchSummary {
  batch_id: string;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  error: number;
  cancelled: number;
  progress: number;
  created_at: string;
  last_updated: string;
}

// Handle CORS errors
serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Get query parameters
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const status = url.searchParams.get('status') || null;
    const batchId = url.searchParams.get('batchId') || null;

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Simplified approach: just get batch IDs directly from batch_id column
    const query = supabaseClient
      .from('crawl_jobs')
      .select('batch_id')
      .not('batch_id', 'is', null);

    // Apply filters if provided
    if (status) {
      query.eq('status', status);
    }
    
    if (batchId) {
      query.eq('batch_id', batchId);
    }

    // Execute query to get distinct batch IDs
    const { data: batchData, error: batchError } = await query
      .order('created_at', { ascending: false })
      .limit(1000); // Get more than we need for distinct filtering

    if (batchError) {
      console.error('Error fetching batch IDs:', batchError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch batch IDs', 
          details: batchError 
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

    // Extract distinct batch IDs (using a Set to remove duplicates)
    const distinctBatchIds = [...new Set(batchData?.map(item => item.batch_id).filter(Boolean) || [])];
    
    // Apply pagination after getting distinct IDs
    const paginatedBatchIds = distinctBatchIds.slice(offset, offset + limit);

    // If no batches found, return empty result
    if (paginatedBatchIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true,
          batches: [], 
          total: 0,
          limit,
          offset
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

    // Get detailed information for each batch
    const batchSummaries: BatchSummary[] = [];
    
    for (const batchId of paginatedBatchIds) {
      try {
        // Get status counts for this batch
        const { data: statusCounts, error: countsError } = await supabaseClient
          .from('crawl_jobs')
          .select('status, count(*)')
          .eq('batch_id', batchId)
          .group('status');
        
        if (countsError) {
          console.error(`Error getting status counts for batch ${batchId}:`, countsError);
          continue; // Skip to next batch on error
        }
        
        // Get batch dates (created and updated)
        const { data: dateTimes, error: datesError } = await supabaseClient
          .from('crawl_jobs')
          .select('created_at, updated_at')
          .eq('batch_id', batchId)
          .order('created_at', { ascending: true })
          .limit(1);
          
        if (datesError) {
          console.error(`Error getting dates for batch ${batchId}:`, datesError);
          continue; // Skip to next batch on error
        }
        
        // Get most recent update
        const { data: lastUpdates, error: updateError } = await supabaseClient
          .from('crawl_jobs')
          .select('updated_at')
          .eq('batch_id', batchId)
          .order('updated_at', { ascending: false })
          .limit(1);
          
        if (updateError) {
          console.error(`Error getting last update for batch ${batchId}:`, updateError);
          continue; // Skip to next batch on error
        }
        
        // Format the status counts
        const countObj = {
          pending: 0,
          processing: 0,
          completed: 0,
          error: 0,
          cancelled: 0,
          total: 0
        };
        
        // Format Date objects
        const createdAt = dateTimes && dateTimes.length > 0 && dateTimes[0].created_at ? 
                         new Date(dateTimes[0].created_at).toISOString() : 
                         new Date().toISOString();
                         
        const lastUpdated = lastUpdates && lastUpdates.length > 0 && lastUpdates[0].updated_at ?
                          new Date(lastUpdates[0].updated_at).toISOString() :
                          new Date().toISOString();
        
        // Count total and by status
        if (statusCounts && Array.isArray(statusCounts)) {
          statusCounts.forEach(item => {
            try {
              if (item && item.status && item.count) {
                const status = String(item.status).toLowerCase();
                if (status in countObj) {
                  // @ts-ignore - We know these properties exist
                  countObj[status] = parseInt(item.count);
                }
                // Add to total
                countObj.total += parseInt(item.count);
              }
            } catch (err) {
              console.error('Error processing status count:', err);
            }
          });
        }
        
        // Calculate progress percentage
        const progress = countObj.total > 0 ? 
          Math.round(((countObj.completed + countObj.error + countObj.cancelled) / countObj.total) * 100) : 0;
        
        // Add to batch summaries
        batchSummaries.push({
          batch_id: batchId,
          total: countObj.total,
          pending: countObj.pending,
          processing: countObj.processing,
          completed: countObj.completed,
          error: countObj.error,
          cancelled: countObj.cancelled,
          progress,
          created_at: createdAt,
          last_updated: lastUpdated
        });
      } catch (err) {
        console.error(`Error processing batch ${batchId}:`, err);
        // Continue to next batch
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        batches: batchSummaries,
        total: distinctBatchIds.length,
        limit,
        offset
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
    console.error('Unexpected error in list-crawl-job-batches:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Unexpected error occurred',
        details: error.message,
        stack: Deno.env.get('ENVIRONMENT') === 'development' ? error.stack : undefined
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