import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

interface RequestBody {
  url: string;
  scraperApiKey?: string; // Optional override, will use secret if not provided
  premium?: boolean;
  ultraPremium?: boolean;
  render?: boolean;
  timeout?: number;
}

interface ResponseData {
  success: boolean;
  html?: string;
  error?: string;
  url?: string;
  processingTimeMs?: number;
}

// Get ScraperAPI key from environment 
const SCRAPER_API_KEY = Deno.env.get('SCRAPER_API_KEY') || '';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    const requestBody: RequestBody = await req.json()
    const { url, scraperApiKey } = requestBody
    
    // Use provided key or fall back to secret
    const apiKey = scraperApiKey || SCRAPER_API_KEY

    if (!url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'URL is required',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'ScraperAPI key not found. Set SCRAPER_API_KEY secret or provide it in the request.',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // Start the timer for performance tracking
    const startTime = Date.now()

    // Determine if this is a protected site that needs special handling
    const protectedSites = ['orientaltrading.com', 'wayfair.com', 'homedepot.com', 'walmart.com']
    const isProtectedSite = protectedSites.some(site => url.includes(site))
    
    // Build ScraperAPI URL
    let scraperUrlParams = new URLSearchParams()
    scraperUrlParams.append('api_key', apiKey)
    scraperUrlParams.append('url', url)
    scraperUrlParams.append('country_code', 'us')
    scraperUrlParams.append('device_type', 'desktop')
    
    // Set premium options based on site type and request settings
    if (isProtectedSite) {
      console.log(`Detected protected site: ${url}`)
      
      // Always use premium for protected sites
      scraperUrlParams.set('premium', 'true')
      
      // Special handling for orientaltrading.com - always use ultra premium with special settings
      if (url.includes('orientaltrading.com')) {
        console.log('Using ultra premium with enhanced settings for orientaltrading.com')
        scraperUrlParams.set('ultra_premium', 'true')
        scraperUrlParams.set('autoparse', 'true')
        scraperUrlParams.set('keep_cookies', 'true')
        
        // Add custom headers as query parameters
        scraperUrlParams.set('X-Forwarded-For', '47.29.201.179') // Random US IP
        scraperUrlParams.set('Accept-Language', 'en-US,en;q=0.9')
        scraperUrlParams.set('Cache-Control', 'no-cache')
        
        // Use a longer timeout for Oriental Trading
        scraperUrlParams.set('timeout', '120000')
        
        // Add special parameters for OT
        scraperUrlParams.set('follow_redirect', 'true')
        
        // Use Chrome browser emulation
        scraperUrlParams.set('browser', 'chrome')
      } else if (requestBody.ultraPremium) {
        scraperUrlParams.set('ultra_premium', 'true')
      } else {
        scraperUrlParams.set('ultra_premium', 'false')
      }
      
      // Always render JavaScript for protected sites
      scraperUrlParams.set('render', 'true')
      
      // Use custom session for consistent results
      scraperUrlParams.set('session_number', '1337')
    } else {
      // For standard sites, use requested settings
      if (requestBody.premium) {
        scraperUrlParams.set('premium', 'true')
      }
      
      if (requestBody.ultraPremium) {
        scraperUrlParams.set('ultra_premium', 'true')
      }
      
      // Default to rendering JavaScript unless explicitly disabled
      scraperUrlParams.set('render', requestBody.render !== false ? 'true' : 'false')
    }
    
    // Add other common options
    scraperUrlParams.set('keep_headers', 'true')
    scraperUrlParams.set('retry_404', 'true')
    scraperUrlParams.set('retry_failed_requests', 'true')
    
    // Build the complete URL
    const scraperUrl = `https://api.scraperapi.com/?${scraperUrlParams.toString()}`
    
    // Set timeout
    const timeout = requestBody.timeout || (isProtectedSite ? 180000 : 120000) // 3 minutes for protected sites, 2 minutes for others
    
    // Call ScraperAPI
    console.log(`Fetching ${url} with ScraperAPI`)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    try {
      const response = await fetch(scraperUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`ScraperAPI returned error: ${response.status} ${response.statusText}`)
      }
      
      const html = await response.text()
      
      // Verify content quality
      if (!html) {
        throw new Error('ScraperAPI returned empty content')
      }
      
      if (html.length < 1000) {
        // Check for common error patterns
        if (html.includes('captcha') || html.includes('CAPTCHA') || 
            html.includes('Access Denied') || html.includes('Robot Detection')) {
          throw new Error(`ScraperAPI hit bot protection (${html.length} bytes). Try ultra premium tier.`)
        }
        
        console.log(`Warning: ScraperAPI returned relatively short content (${html.length} bytes)`)
      }
      
      // Calculate processing time
      const endTime = Date.now()
      const processingTimeMs = endTime - startTime
      
      // Return success with HTML content
      const responseData: ResponseData = {
        success: true,
        html,
        url,
        processingTimeMs
      }
      
      return new Response(JSON.stringify(responseData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } catch (fetchError) {
      clearTimeout(timeoutId)
      
      let errorMessage = fetchError.message
      
      if (fetchError.name === 'AbortError') {
        errorMessage = `ScraperAPI request timed out after ${timeout/1000} seconds`
      }
      
      throw new Error(`ScraperAPI error: ${errorMessage}`)
    }
  } catch (error) {
    console.error(`Error: ${error.message}`)
    
    const responseData: ResponseData = {
      success: false,
      error: error.message
    }
    
    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})