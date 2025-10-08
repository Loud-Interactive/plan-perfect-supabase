// check-database-tables
// A utility function to check database tables and their contents

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
    
    console.log('Checking database tables');
    
    // Get list of all tables
    const { data: tables, error: tablesError } = await supabaseClient.rpc(
      'list_tables'
    );
    
    if (tablesError) {
      throw new Error(`Failed to list tables: ${tablesError.message}`);
    }
    
    // Get row counts for relevant tables
    const tableCounts = {};
    
    for (const table of ['gsc_page_query_daily', 'pages', 'gsc_keywords', 'gsc_job_queue']) {
      try {
        const { count, error } = await supabaseClient
          .from(table)
          .select('*', { count: 'exact', head: true });
          
        tableCounts[table] = {
          count: count,
          error: error ? error.message : null
        };
      } catch (e) {
        tableCounts[table] = {
          count: null,
          error: e instanceof Error ? e.message : 'Unknown error'
        };
      }
    }
    
    // Sample data from gsc_page_query_daily
    const { data: gscSample, error: gscError } = await supabaseClient
      .from('gsc_page_query_daily')
      .select('*')
      .limit(5);
      
    // Check the gsc_keywords table structure
    let keywordsStructure = null;
    try {
      const { data: columns, error } = await supabaseClient.rpc(
        'get_table_columns',
        { table_name: 'gsc_keywords' }
      );
      
      keywordsStructure = {
        columns,
        error: error ? error.message : null
      };
    } catch (e) {
      keywordsStructure = {
        columns: null,
        error: e instanceof Error ? e.message : 'Unknown error'
      };
    }
    
    // Check if there's a trigger on gsc_page_query_daily
    let triggers = null;
    try {
      const { data: triggerData, error } = await supabaseClient.rpc(
        'get_table_triggers',
        { table_name: 'gsc_page_query_daily' }
      );
      
      triggers = {
        data: triggerData,
        error: error ? error.message : null
      };
    } catch (e) {
      triggers = {
        data: null,
        error: e instanceof Error ? e.message : 'Unknown error'
      };
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        tables,
        tableCounts,
        gscSample,
        keywordsStructure,
        triggers
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