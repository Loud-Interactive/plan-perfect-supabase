// supabase/functions/setup-search-queue/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Setting up outline search queue table');
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // SQL to create the queue table
    const createTableSQL = `
    -- Create the outline_search_queue table for progressive search processing
    CREATE TABLE IF NOT EXISTS outline_search_queue (
      id SERIAL PRIMARY KEY,
      job_id UUID REFERENCES outline_generation_jobs(id),
      search_term TEXT NOT NULL,
      category TEXT,
      priority INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      processed_at TIMESTAMP WITH TIME ZONE,
      result_count INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0
    );

    -- Add indexes for faster lookups
    CREATE INDEX IF NOT EXISTS idx_outline_search_queue_job_id ON outline_search_queue(job_id);
    CREATE INDEX IF NOT EXISTS idx_outline_search_queue_status ON outline_search_queue(status);
    CREATE INDEX IF NOT EXISTS idx_outline_search_queue_priority ON outline_search_queue(priority);

    -- Add comments to document purpose
    COMMENT ON TABLE outline_search_queue IS 'Stores search terms queue for progressive processing to avoid timeouts';
    `;
    
    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql: createTableSQL });
    
    if (error) {
      throw new Error(`Failed to create table: ${error.message}`);
    }
    
    console.log('Outline search queue table created successfully');
    
    return new Response(
      JSON.stringify({ success: true, message: 'Outline search queue table created successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error setting up outline search queue:', error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});