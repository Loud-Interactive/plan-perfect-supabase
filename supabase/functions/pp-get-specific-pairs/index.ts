import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDomain, stringToBool, corsHeaders } from '../helpers/index.ts';

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    // Initialize Supabase client with service role key for anonymous access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Extract domain from query parameter
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain');
    
    if (!domain) {
      throw new Error('Domain parameter is required');
    }
    
    console.log('Processing domain:', domain);
    
    // Get keys array from request body
    const { keys } = await req.json();
    
    if (!Array.isArray(keys)) {
      throw new Error('Keys must be provided as an array');
    }
    
    const normalizedDomain = normalizeDomain(domain);
    
    // Get specific keys from the latest_pairs view
    const { data, error } = await supabaseClient
      .from('latest_pairs')
      .select('key, value')
      .eq('domain', normalizedDomain)
      .in('key', keys);
    
    if (error) throw error;
    
    // Transform data into key-value object
    const result: Record<string, any> = {};
    for (const row of data || []) {
      result[row.key] = stringToBool(row.value);
    }
    
    // Check for missing keys
    const foundKeys = Object.keys(result);
    const missingKeys = keys.filter(key => !foundKeys.includes(key));
    
    if (missingKeys.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: `The following keys were not found: ${missingKeys.join(', ')}`,
          result
        }),
        { status: 404, headers: corsHeaders }
      );
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        data: result
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-get-specific-pairs:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: error.message 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});