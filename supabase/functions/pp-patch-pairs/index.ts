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
    
    // Extract domain from query parameter
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain');
    
    if (!domain) {
      throw new Error('Domain parameter is required');
    }
    
    console.log('Processing domain:', domain);
    
    // Get updates from request body
    const updates = await req.json();
    
    if (!updates || typeof updates !== 'object') {
      throw new Error('Request body must be a valid object with key-value pairs');
    }
    
    const normalizedDomain = normalizeDomain(domain);
    
    // Check if domain exists and get its GUID
    const { data: existingPair, error: findError } = await supabaseClient
      .from('pairs')
      .select('guid')
      .eq('domain', normalizedDomain)
      .order('last_updated', { ascending: false })
      .limit(1);
    
    if (findError) throw findError;
    
    if (!existingPair || existingPair.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false,
          message: 'Domain not found.' 
        }),
        { status: 404, headers: corsHeaders }
      );
    }
    
    const guid = existingPair[0].guid;
    const updatedKeys = [];
    const errors = [];
    
    // Process updates
    for (const [key, value] of Object.entries(updates)) {
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
        message: 'Pairs updated successfully',
        updated_keys: updatedKeys
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error in pp-patch-pairs:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false,
        message: error.message 
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});