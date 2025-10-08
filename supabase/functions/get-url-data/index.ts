import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface ResponseData {
  success: boolean;
  urlData?: any;
  error?: string;
}

// Get Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get URL ID from URL parameters
    const url = new URL(req.url);
    const urlId = url.searchParams.get('id');
    
    if (!urlId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'URL ID is required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }
    
    // Get URL data
    const { data: urlData, error: urlError } = await supabase
      .from('page_perfect_url_status')
      .select('*')
      .eq('id', urlId)
      .single();
      
    if (urlError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `URL not found: ${urlError.message}`,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      )
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        urlData
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});