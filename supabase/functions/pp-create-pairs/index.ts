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
    
    // Parse request body
    const { domain, key_value_pairs, guid } = await req.json();
    
    if (!domain) {
      throw new Error('Domain is required');
    }
    
    if (!key_value_pairs || typeof key_value_pairs !== 'object') {
      throw new Error('key_value_pairs must be a valid object');
    }
    
    // Normalize domain to prevent duplicates
    const normalizedDomain = normalizeDomain(domain);
    
    // Find existing GUID or create new one
    let pairGuid = guid;
    
    if (!pairGuid) {
      const { data: existingPair } = await supabaseClient
        .from('pairs')
        .select('guid')
        .eq('domain', normalizedDomain)
        .order('last_updated', { ascending: false })
        .limit(1);
      
      pairGuid = existingPair && existingPair.length > 0 
        ? existingPair[0].guid 
        : crypto.randomUUID();
    }
    
    // Process each key-value pair
    for (const [key, value] of Object.entries(key_value_pairs)) {
      const formattedValue = boolToString(value);
      
      const { error } = await supabaseClient
        .from('pairs')
        .upsert({
          domain: normalizedDomain,
          guid: pairGuid,
          key,
          value: formattedValue,
          last_updated: new Date().toISOString()
        });
      
      if (error) throw error;
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Pairs updated successfully.',
        guid: pairGuid
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-create-pairs:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: 'An error occurred while processing the request.',
        error: error.message
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});