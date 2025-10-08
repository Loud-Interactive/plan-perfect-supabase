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
    
    // Extract domain and guid from query parameters
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain');
    const guid = url.searchParams.get('guid');
    
    if (!domain || !guid) {
      throw new Error('Domain and GUID parameters are required');
    }
    
    console.log('Processing domain:', domain, 'guid:', guid);
    
    // Get key-value pairs from request body
    const keyValuePairs = await req.json();
    
    if (!keyValuePairs || typeof keyValuePairs !== 'object') {
      throw new Error('Request body must be a valid object with key-value pairs');
    }
    
    const normalizedDomain = normalizeDomain(domain);
    
    // Batch update all pairs
    const updatedKeys = [];
    const errors = [];
    
    for (const [key, value] of Object.entries(keyValuePairs)) {
      try {
        const formattedValue = boolToString(value);
        
        const { error } = await supabaseClient
          .from('pairs')
          .upsert({
            domain: normalizedDomain,
            guid,
            key,
            value: formattedValue,
            last_updated: new Date().toISOString()
          });
        
        if (error) {
          errors.push({ key, error: error.message });
        } else {
          updatedKeys.push(key);
        }
      } catch (error) {
        errors.push({ key, error: error.message });
      }
    }
    
    // Report partial success if some keys were updated but others failed
    if (updatedKeys.length > 0 && errors.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          partial: true,
          message: 'Some pairs were updated successfully, but others failed.',
          updated_keys: updatedKeys,
          errors
        }),
        { status: 207, headers: corsHeaders }
      );
    }
    
    // Report complete failure if no keys were updated
    if (updatedKeys.length === 0 && errors.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to update any pairs.',
          errors
        }),
        { status: 500, headers: corsHeaders }
      );
    }
    
    // Report complete success if all keys were updated
    return new Response(
      JSON.stringify({
        success: true,
        message: 'All pairs updated successfully.',
        updated_keys: updatedKeys
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-update-pairs:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: error.message 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});