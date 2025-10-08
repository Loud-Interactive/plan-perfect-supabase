import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Test environment variables
    const envVars = {
      SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? 'SET' : 'NOT SET',
      PROJECT_URL: Deno.env.get('PROJECT_URL'),
      SERVICE_ROLE_KEY: Deno.env.get('SERVICE_ROLE_KEY') ? 'SET' : 'NOT SET',
    }

    // Test database connection
    let dbTest = 'NOT TESTED'
    if (envVars.SUPABASE_URL && Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      const supabase = createClient(envVars.SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error } = await supabase
        .from('synopsis_jobs')
        .select('count')
        .limit(1)
      
      dbTest = error ? `ERROR: ${error.message}` : 'SUCCESS'
    }

    return new Response(
      JSON.stringify({
        success: true,
        environment: envVars,
        database_test: dbTest,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})