// PagePerfect: protected-site-scraper
// Special handler for protected sites that are difficult to scrape
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
  successMethod?: string;
}

// Get ScraperAPI key from environment 
const SCRAPER_API_KEY = Deno.env.get('SCRAPER_API_KEY') || '';

// List of known protected sites
const PROTECTED_SITES = [
  'orientaltrading.com',
  'wayfair.com',
  'homedepot.com',
  'walmart.com',
  'target.com',
  'bestbuy.com',
  'lowes.com',
  'amazon.com',
  'etsy.com'
];

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

    // Verify this is a protected site
    const domain = extractDomain(url);
    const isProtectedSite = PROTECTED_SITES.some(site => domain.includes(site));
    
    if (!isProtectedSite) {
      console.log(`Note: ${domain} is not in the known protected sites list, but will attempt scraping anyway`);
    }

    // Start the timer for performance tracking
    const startTime = Date.now()
    
    // Log the request for debugging
    console.log(`Processing protected site URL: ${url}`);
    
    // Get site-specific strategies
    const strategies = getStrategiesForSite(url, domain);
    
    // Try different approaches to fetch the content
    const { html, method } = await fetchWithMultipleStrategies(url, apiKey, strategies);
    
    // Calculate processing time
    const endTime = Date.now()
    const processingTimeMs = endTime - startTime
    
    // Return success with HTML content
    const responseData: ResponseData = {
      success: true,
      html,
      url,
      processingTimeMs,
      successMethod: method
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

// Extract domain from URL
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch (e) {
    return url.toLowerCase(); // Fallback if URL parsing fails
  }
}

// Get site-specific scraping strategies
function getStrategiesForSite(url: string, domain: string): any[] {
  // Common strategies for all sites
  const commonStrategies = [
    {
      name: "Ultra Premium with Chrome Emulation",
      params: getScraperParams('chrome', true, url)
    },
    {
      name: "Ultra Premium with Firefox Emulation",
      params: getScraperParams('firefox', true, url)
    },
    {
      name: "Premium with US Proxy",
      params: getScraperParams('chrome', false, url)
    }
  ];
  
  // Add site-specific strategies
  if (domain.includes('orientaltrading.com')) {
    return [
      // Oriental Trading specific strategies first
      {
        name: "OT Special - Chrome with Custom Headers",
        params: getOrientalTradingParams('chrome', url)
      },
      {
        name: "OT Special - Firefox with Autoparse",
        params: getOrientalTradingParams('firefox', url)
      },
      ...commonStrategies
    ];
  } else if (domain.includes('wayfair.com')) {
    return [
      // Wayfair specific strategies first
      {
        name: "Wayfair - Mobile Emulation",
        params: getWayfairParams('mobile', url)
      },
      ...commonStrategies
    ];
  } else if (domain.includes('amazon.com')) {
    return [
      // Amazon specific strategies first
      {
        name: "Amazon - Shopping Browser",
        params: getAmazonParams(url)
      },
      ...commonStrategies
    ];
  } else {
    // Default to common strategies for other sites
    return commonStrategies;
  }
}

// Attempts multiple strategies to fetch the content
async function fetchWithMultipleStrategies(url: string, apiKey: string, strategies: any[]): Promise<{html: string, method: string}> {
  // Array of additional fallback approaches if all strategies fail
  const fallbackApproaches = [
    {
      name: "Direct Request with Custom Headers",
      fetchFn: () => fetchWithCustomHeaders(url)
    }
  ];

  // Combine strategies with fallbacks
  const allApproaches = [...strategies, ...fallbackApproaches];

  // Try each approach
  let lastError = null;
  for (const approach of allApproaches) {
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
        html = await approach.fetchFn();
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
      
      // If we got here, we have good HTML
      console.log(`Successfully fetched HTML (${html.length} bytes) using approach: ${approach.name}`);
      return { html, method: approach.name };
    } catch (error) {
      // Log the error and continue to the next approach
      console.error(`Error with approach ${approach.name}: ${error.message}`);
      lastError = error;
    }
  }
  
  // If we get here, all approaches failed
  throw new Error(`All fetch attempts failed. Last error: ${lastError?.message}`);
}

// Build generic parameters for ScraperAPI
function getScraperParams(browser: string, useUltraPremium: boolean, url: string): URLSearchParams {
  const params = new URLSearchParams();
  params.append('api_key', SCRAPER_API_KEY);
  params.append('url', url);
  
  // Base options
  params.set('country_code', 'us');
  params.set('device_type', 'desktop');
  params.set('premium', 'true');
  params.set('ultra_premium', useUltraPremium ? 'true' : 'false');
  params.set('render', 'true');
  
  // Common parameters for protected sites
  params.set('keep_cookies', 'true');
  params.set('retry_404', 'true');
  params.set('timeout', '180000'); // 3 minutes
  params.set('retry_failed_requests', 'true');
  params.set('follow_redirect', 'true');
  
  // Set browser emulation if specified
  if (browser) {
    params.set('browser', browser);
  }
  
  return params;
}

// Oriental Trading specific parameters
function getOrientalTradingParams(browser: string, url: string): URLSearchParams {
  const params = getScraperParams(browser, true, url);
  
  // Add special parameters for Oriental Trading
  params.set('timeout', '240000'); // 4 minutes
  params.set('autoparse', 'true');
  
  // Add custom headers as query parameters
  params.set('X-Forwarded-For', '52.14.153.' + Math.floor(Math.random() * 255)); // Random US IP
  params.set('Accept-Language', 'en-US,en;q=0.9');
  params.set('Cache-Control', 'no-cache');
  params.set('Referer', 'https://www.google.com/');
  
  return params;
}

// Wayfair specific parameters
function getWayfairParams(deviceType: string, url: string): URLSearchParams {
  const params = getScraperParams('chrome', true, url);
  
  params.set('device_type', deviceType);
  params.set('timeout', '90000'); // 1.5 minutes
  
  return params;
}

// Amazon specific parameters
function getAmazonParams(url: string): URLSearchParams {
  const params = getScraperParams('chrome', true, url);
  
  params.set('session_number', '12345'); // Consistent session for Amazon
  params.set('X-Amazon-Token', 'consumer');
  
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