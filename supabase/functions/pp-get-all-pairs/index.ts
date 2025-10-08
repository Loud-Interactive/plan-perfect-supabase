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
    
    const normalizedDomain = normalizeDomain(domain);
    
    // Get all pairs including history
    const { data, error } = await supabaseClient
      .from('pairs')
      .select('*')
      .eq('domain', normalizedDomain)
      .order('last_updated', { ascending: false });
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'No records found for the specified domain.' 
        }),
        { status: 404, headers: corsHeaders }
      );
    }
    
    // Transform boolean strings
    const transformedData = data.map(row => ({
      ...row,
      value: stringToBool(row.value)
    }));
    
    return new Response(
      JSON.stringify({
        success: true,
        data: transformedData
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-get-all-pairs:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: error.message 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});