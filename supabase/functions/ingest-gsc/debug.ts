// Debug version of ingest-gsc function
// This version focuses only on the database insertion part

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

    // Create a simple test dataset
    const testData = [
      {
        fetched_date: '2025-04-25',
        page_url: 'https://test.com/page1',
        keyword: 'test keyword 1',
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 5.5
      },
      {
        fetched_date: '2025-04-25',
        page_url: 'https://test.com/page2',
        keyword: 'test keyword 2',
        clicks: 5,
        impressions: 50, 
        ctr: 0.1,
        position: 3.2
      }
    ];
    
    console.log("Test data:", JSON.stringify(testData, null, 2));
    
    // Attempt to insert test data directly
    console.log("\nTest: Passing data directly to RPC function");
    
    const rpcResult = await supabaseClient.rpc(
      'bulk_insert_gsc_page_query',
      { data: testData }
    );
    
    if (rpcResult.error) {
      console.error(`Database RPC error:`, rpcResult.error);
      throw new Error(`Database error: ${rpcResult.error.message}`);
    }
    
    // The SQL function returns the number of rows inserted
    const rowsInserted = rpcResult.data;
    console.log(`Successfully inserted ${rowsInserted} rows into database`);
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Debug test successful',
        rowsProcessed: rowsInserted,
        test_data: testData
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // Return error response
    console.error("Error:", error);
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