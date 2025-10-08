// supabase/functions/fetch-domain-preferences/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

function extractRootDomain(url: string): string {
  try {
    let hostname = new URL(url).hostname
    const parts = hostname.split('.')
    if (parts.length > 2) {
      if (parts[0] === 'www') {
        hostname = parts.slice(1).join('.')
      } else {
        const tldParts = parts[parts.length - 1].length <= 3 && parts.length > 2 ? 3 : 2
        hostname = parts.slice(-tldParts).join('.')
      }
    }
    return hostname
  } catch (error) {
    console.error("Error extracting domain:", error)
    return ""
  }
}

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
    const { url, domain: providedDomain } = await req.json()
    
    if (!url && !providedDomain) {
      return new Response(JSON.stringify({ error: 'URL or domain is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Extract domain from URL if domain not provided
    const domain = providedDomain || extractRootDomain(url)
    
    if (!domain) {
      return new Response(JSON.stringify({ error: 'Could not extract domain from URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    console.log(`Fetching domain preferences for: ${domain}`)
    
    // Call PerfectPerfect API to get domain data
    const ppApiUrl = `https://pp-api.replit.app/pairs/all/${domain}`
    const domainResponse = await fetch(ppApiUrl)
    
    if (!domainResponse.ok) {
      const errorText = await domainResponse.text()
      console.error("PP API error:", domainResponse.status, errorText)
      return new Response(JSON.stringify({ 
        error: `Failed to fetch domain data: ${domainResponse.status} - ${domainResponse.statusText}`,
        details: errorText
      }), {
        status: domainResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const domainData = await domainResponse.json()
    console.log(`Successfully retrieved domain data for ${domain}`)
    
    // Extract useful data from response
    const { 
      synopsis, 
      JSON_LD_Schema_Post_Template, 
      json_ld_schema_generation_prompt 
    } = domainData
    
    return new Response(JSON.stringify({ 
      domain,
      synopsis: synopsis || "",
      jsonLdSchemaPostTemplate: JSON_LD_Schema_Post_Template || "",
      jsonLdSchemaGenerationPrompt: json_ld_schema_generation_prompt || "",
      fullData: domainData // Include full data for reference
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error("Error fetching domain preferences:", error)
    
    return new Response(JSON.stringify({ 
      error: `Error fetching domain preferences: ${error.message}` 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
