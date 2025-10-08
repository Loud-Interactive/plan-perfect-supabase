import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDomain, boolToString, corsHeaders } from '../helpers/index.ts';

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
    
    // Extract domain, guid, and key from query parameters
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain');
    const guid = url.searchParams.get('guid');
    const key = url.searchParams.get('key');
    
    if (!domain || !guid || !key) {
      throw new Error('Domain, GUID, and key parameters are required');
    }
    
    console.log('Processing domain:', domain, 'guid:', guid, 'key:', key);
    
    // Get value from request body
    const { value } = await req.json();
    
    if (value === undefined) {
      throw new Error('Value is required in the request body');
    }
    
    const normalizedDomain = normalizeDomain(domain);
    const formattedValue = boolToString(value);
    
    // Update the specific pair
    const { error } = await supabaseClient
      .from('pairs')
      .update({ 
        value: formattedValue, 
        last_updated: new Date().toISOString() 
      })
      .eq('domain', normalizedDomain)
      .eq('guid', guid)
      .eq('key', key);
    
    if (error) throw error;
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Pair updated successfully' 
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-update-pair:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: error.message 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});