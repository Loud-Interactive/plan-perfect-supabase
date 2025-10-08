// PagePerfect: orientaltrading-fetch
// Special handler for Oriental Trading URLs that are difficult to scrape
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

interface RequestBody {
  url: string;
  scraperApiKey?: string; // Optional override, will use secret if not provided
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

    // Verify this is an Oriental Trading URL
    if (!url.includes('orientaltrading.com')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'This function is specifically for Oriental Trading URLs',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // Start the timer for performance tracking
    const startTime = Date.now()
    
    // Log the request for debugging
    console.log(`Processing Oriental Trading URL: ${url}`)
    
    // Try different approaches to fetch the content
    const html = await fetchWithMultipleAttempts(url, apiKey);
    
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

// Attempts multiple strategies to fetch the content from Oriental Trading
async function fetchWithMultipleAttempts(url: string, apiKey: string): Promise<string> {
  // Array of approaches to try
  const approaches = [
    {
      name: "Ultra Premium with Chrome Emulation",
      params: getUltraPremiumParams(apiKey, url, {
        browser: 'chrome', 
        ultraPremium: true,
        autoparse: true
      })
    },
    {
      name: "Ultra Premium with Firefox Emulation",
      params: getUltraPremiumParams(apiKey, url, {
        browser: 'firefox', 
        ultraPremium: true,
        autoparse: true
      })
    },
    {
      name: "Premium with US Proxy",
      params: getUltraPremiumParams(apiKey, url, {
        browser: 'chrome',
        ultraPremium: false,
        country_code: 'us'
      })
    },
    {
      name: "Direct request with Custom Headers",
      fetchFn: fetchWithCustomHeaders
    }
  ];

  // Try each approach
  let lastError = null;
  for (const approach of approaches) {
    try {
      console.log(`Trying approach: ${approach.name}`);
      
      let html;
      if (approach.params) {
        // Use ScraperAPI with specific parameters
        const scraperUrl = `https://api.scraperapi.com/?${approach.params.toString()}`;
        console.log(`ScraperAPI URL: ${scraperUrl.substring(0, 100)}...`);
        
        const response = await fetch(scraperUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        if (!response.ok) {
          throw new Error(`ScraperAPI returned error: ${response.status} ${response.statusText}`);
        }
        
        html = await response.text();
      } else if (approach.fetchFn) {
        // Use custom fetch function
        html = await approach.fetchFn(url);
      }
      
      // Validate the HTML
      if (!html || html.length < 1000) {
        throw new Error(`Received too short HTML: ${html?.length || 0} bytes`);
      }
      
      // Check for common error patterns
      if (html.includes('captcha') || html.includes('CAPTCHA') || 
          html.includes('Access Denied') || html.includes('Robot Detection') ||
          html.includes('Something went wrong') || html.includes('Error Page')) {
        throw new Error(`Received error page or captcha`);
      }
      
      // Make sure we got Oriental Trading content
      if (!html.includes('Oriental Trading') || !html.includes('oriental trading')) {
        throw new Error(`Response doesn't appear to be from Oriental Trading`);
      }
      
      // If we got here, we have good HTML
      console.log(`Successfully fetched HTML (${html.length} bytes) using approach: ${approach.name}`);
      return html;
    } catch (error) {
      // Log the error and continue to the next approach
      console.error(`Error with approach ${approach.name}: ${error.message}`);
      lastError = error;
    }
  }
  
  // If we get here, all approaches failed
  throw new Error(`All fetch attempts failed. Last error: ${lastError?.message}`);
}

// Build parameters for ScraperAPI
function getUltraPremiumParams(apiKey: string, url: string, options: any = {}): URLSearchParams {
  const params = new URLSearchParams();
  params.append('api_key', apiKey);
  params.append('url', url);
  
  // Base options
  params.set('country_code', options.country_code || 'us');
  params.set('device_type', 'desktop');
  params.set('premium', 'true');
  params.set('ultra_premium', options.ultraPremium !== false ? 'true' : 'false');
  params.set('render', 'true');
  
  // Add special parameters for Oriental Trading
  params.set('keep_cookies', 'true');
  params.set('retry_404', 'true');
  params.set('timeout', '120000'); // 2 minutes
  params.set('retry_failed_requests', 'true');
  params.set('follow_redirect', 'true');
  
  // Set browser emulation if specified
  if (options.browser) {
    params.set('browser', options.browser);
  }
  
  // Set autoparse if enabled
  if (options.autoparse) {
    params.set('autoparse', 'true');
  }
  
  // Add custom headers as query parameters
  params.set('X-Forwarded-For', '52.14.153.' + Math.floor(Math.random() * 255)); // Random US IP
  params.set('Accept-Language', 'en-US,en;q=0.9');
  params.set('Cache-Control', 'no-cache');
  
  return params;
}

// Alternative approach using direct fetch with custom headers
async function fetchWithCustomHeaders(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Direct fetch failed: ${response.status} ${response.statusText}`);
  }
  
  return await response.text();
}