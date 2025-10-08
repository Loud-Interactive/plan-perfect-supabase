// supabase/functions/get-ai-style-guide/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }
  
  // Get domain from query parameter or from POST body
  let domain = '';
  
  if (req.method === 'GET') {
    const url = new URL(req.url);
    domain = url.searchParams.get('domain') || '';
  } else if (req.method === 'POST') {
    const body = await req.json();
    domain = body.domain || '';
  } else {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (!domain) {
    return new Response(JSON.stringify({ error: 'Domain is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // Normalize domain (remove protocols and www)
    const normalizedDomain = domain.toLowerCase()
      .replace('https://', '')
      .replace('http://', '')
      .replace('www.', '')
      .replace(/\/$/, ''); // Remove trailing slash
    
    console.log(`Fetching AI style guide for domain: ${normalizedDomain}`);
    
    // Construct the URL for the preferencesPerfect API
    const ppApiUrl = `https://pp-api.replit.app/pairs/specific/${normalizedDomain}`;
    
    // Request the specific keys we need
    const response = await fetch(ppApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys: ['ai_style_guide'] }),
    });
    
    if (!response.ok) {
      // If response has a specific error message, extract it
      let errorMessage = 'Failed to fetch style guide';
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch (e) {
        // Ignore parsing errors
      }
      
      // Return 404 if the response specifically says keys not found
      if (response.status === 404) {
        return new Response(JSON.stringify({
          success: false,
          message: 'No AI style guide found for this domain',
          domain: normalizedDomain
        }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Return other errors
      return new Response(JSON.stringify({
        success: false,
        message: errorMessage,
        domain: normalizedDomain
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Parse the response
    const responseData = await response.json();
    
    // Check if the key exists in the response
    if (!responseData.ai_style_guide) {
      return new Response(JSON.stringify({
        success: false,
        message: 'No AI style guide found for this domain',
        domain: normalizedDomain
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Return the style guide
    return new Response(JSON.stringify({
      success: true,
      domain: normalizedDomain,
      style_guide: responseData.ai_style_guide
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching AI style guide:', error);
    
    return new Response(JSON.stringify({
      success: false,
      message: `Error fetching AI style guide: ${error.message}`,
      domain
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
})