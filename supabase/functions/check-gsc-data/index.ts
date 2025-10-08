// check-gsc-data
// A utility function to check the GSC data stored in the database

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    console.log('Checking GSC data in database');
    
    // Get data from URL query parameters
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || '2025-03-01';
    const page = url.searchParams.get('page');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    
    // Query to get GSC data
    let query = supabaseClient
      .from('gsc_page_query_daily')
      .select('*')
      .eq('fetched_date', date)
      .order('impressions', { ascending: false })
      .limit(limit);
      
    // Add page filter if provided
    if (page) {
      query = query.ilike('page_url', `%${page}%`);
    }
    
    const { data: gscData, error: gscError } = await query;
    
    if (gscError) {
      throw new Error(`Failed to get GSC data: ${gscError.message}`);
    }
    
    // Also get pages count
    const { count: pagesCount, error: countError } = await supabaseClient
      .from('pages')
      .select('*', { count: 'exact', head: true });
      
    if (countError) {
      console.error('Error counting pages:', countError);
    }
    
    // Get total row count
    const { count: totalRows, error: rowsError } = await supabaseClient
      .from('gsc_page_query_daily')
      .select('*', { count: 'exact', head: true });
      
    if (rowsError) {
      console.error('Error counting rows:', rowsError);
    }
    
    // Get some count statistics
    const { data: stats, error: statsError } = await supabaseClient.rpc(
      'get_gsc_data_stats',
      { p_fetched_date: date }
    );
    
    let statsData = null;
    if (statsError) {
      console.error('Error getting stats:', statsError);
    } else {
      statsData = stats?.[0];
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        date,
        pagesCount: pagesCount,
        totalRows: totalRows,
        rowsReturned: gscData?.length || 0,
        stats: statsData,
        data: gscData || []
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});