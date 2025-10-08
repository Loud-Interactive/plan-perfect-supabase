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
    
    // Test 1: Attempt to insert test data directly
    console.log("\nTest 1: Passing data directly to RPC function");
    
    const rpcResult1 = await supabaseClient.rpc(
      'bulk_insert_gsc_page_query',
      { data: testData }
    );
    
    console.log("Result 1:", rpcResult1);
    
    // Test 2: Try with JSON.stringify
    console.log("\nTest 2: Passing stringified data to RPC function");
    
    const rpcResult2 = await supabaseClient.rpc(
      'bulk_insert_gsc_page_query',
      { data: JSON.stringify(testData) }
    );
    
    console.log("Result 2:", rpcResult2);
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Debug test completed',
        result1: rpcResult1,
        result2: rpcResult2
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