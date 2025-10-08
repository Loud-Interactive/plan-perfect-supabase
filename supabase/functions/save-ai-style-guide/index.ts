// supabase/functions/save-ai-style-guide/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  // Set CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
  
  try {
    // Parse the request body
    const { domain, style_guide, thinking } = await req.json()
    
    if (!domain) {
      return new Response(JSON.stringify({ error: 'Domain is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    if (!style_guide) {
      return new Response(JSON.stringify({ error: 'Style guide content is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Saving AI style guide for domain: ${domain} (${style_guide.length} characters)`)
    if (thinking) {
      console.log(`Also saving thinking content (${thinking.length} characters)`)
    }
    
    // Normalize domain (remove protocols and www)
    const normalizedDomain = domain.toLowerCase()
      .replace('https://', '')
      .replace('http://', '')
      .replace('www.', '')
      .replace(/\/$/, ''); // Remove trailing slash
    
    // Construct payload for the preferencesPerfect API
    const key_value_pairs = {
      ai_style_guide: style_guide
    };
    
    // Add thinking to payload if available
    if (thinking) {
      key_value_pairs.ai_style_guide_thinking = thinking;
    }
    
    const payload = {
      domain: normalizedDomain,
      key_value_pairs
    }
    
    // Send the payload to the preferencesPerfect API
    const response = await fetch('https://pp-api.replit.app/pairs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    
    // Get the response
    const responseData = await response.json()
    
    // Return response based on API response
    if (response.ok) {
      console.log(`Successfully saved AI style guide for domain: ${normalizedDomain}`)
      return new Response(JSON.stringify({
        success: true,
        message: "Style guide saved successfully",
        domain: normalizedDomain
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } else {
      console.error(`Error saving style guide: ${JSON.stringify(responseData)}`)
      return new Response(JSON.stringify({
        success: false,
        message: "Failed to save style guide",
        error: responseData.message || "Unknown error",
        api_response: responseData
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
  } catch (error) {
    console.error('Error saving AI style guide:', error)
    
    return new Response(JSON.stringify({
      success: false,
      message: `Failed to save style guide: ${error.message}`
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})