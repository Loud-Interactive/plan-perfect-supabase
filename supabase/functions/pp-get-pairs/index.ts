import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDomain, stringToBool, corsHeaders } from '../helpers/index.ts';

serve(async (req: Request) => {
  // Debug headers and environment
  console.log('Environment variables available:', Object.keys(Deno.env.toObject()));
  console.log('SUPABASE_URL:', Deno.env.get('SUPABASE_URL'));
  console.log('SERVICE_ROLE_KEY available:', !!Deno.env.get('SERVICE_ROLE_KEY'));
  console.log('SUPABASE_SERVICE_ROLE_KEY available:', !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    // Try with both possible key names
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
    console.log('Using service role key (redacted):', serviceRoleKey ? '****' + serviceRoleKey.slice(-4) : 'NOT FOUND');
    
    // Initialize Supabase client with service role key for anonymous access
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey
    );
    
    // Extract domain from query parameter
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain');
    
    if (!domain) {
      throw new Error('Domain parameter is required');
    }
    
    console.log('Processing domain:', domain);
    const normalizedDomain = normalizeDomain(domain);
    
    console.log('Normalized domain:', normalizedDomain);

    // Query to get only the latest entry for each key
    const { data, error } = await supabaseClient
      .rpc('get_latest_pairs', { domain_param: normalizedDomain });
    
    console.log('Query result:', { dataCount: data?.length || 0, error });
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      console.log('No data found for domain:', normalizedDomain);
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'No records found for the specified domain.' 
        }),
        { status: 404, headers: corsHeaders }
      );
    }
    
    console.log('Found data:', data);
    
    // Transform data into expected format
    const result: Record<string, any> = {
      success: true,
      domain: normalizedDomain,
      guid: data[0].guid
    };
    
    for (const row of data) {
      result[row.key] = stringToBool(row.value);
    }
    
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-get-pairs:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: error.message 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});