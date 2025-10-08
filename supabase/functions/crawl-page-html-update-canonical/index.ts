// PagePerfect: crawl-page-html-update-canonical
// Function to fetch HTML content from URLs, discover canonical URLs, and update the database
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  url: string;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request
    const { url } = await req.json() as RequestBody;

    if (!url) {
      throw new Error('URL is required');
    }

    // Check if URL is valid
    try {
      new URL(url);
    } catch (error) {
      throw new Error('Invalid URL format');
    }

    console.log(`Crawling URL with canonical discovery: ${url}`);

    let htmlContent: string | null = null;
    let crawlMethod = 'direct';
    
    // STEP 1: Try ethical bot-first approach with cascading fallbacks
    console.log(`Attempting ethical bot-first crawling...`);
    
    try {
      // ATTEMPT 1: Try with proper LoudSEOBot identification (ethical/compliance requirement)
      console.log(`🤖 ATTEMPT 1: LoudSEOBot identification (clients depend on this)`);
      
      try {
        const botResponse = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LoudSEOBot/1.0; +https://pageperfect.ai/bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'LoudSEOBot-Key': 'a7b9c3d1-4e8f-4a2b-9c7d-3f1e5a8b9c2d',
            'loud-int': 'true',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000)
        });
        
        const botHtml = await botResponse.text();
        console.log(`🤖 Bot response: HTTP ${botResponse.status}, HTML length: ${botHtml.length}`);
        
        // Accept bot response if it's successful OR if it's a legitimate error (not 403 Forbidden)
        if (botResponse.status === 200 || 
            (botResponse.status >= 400 && botResponse.status < 500 && botResponse.status !== 403)) {
          
          const isBlocked = detectBlockedResponse(botHtml);
          if (!isBlocked) {
            console.log(`✅ Bot identification successful! Status: ${botResponse.status}`);
            htmlContent = botHtml;
            crawlMethod = 'bot-direct';
          } else {
            console.log(`⚠️ Bot response blocked: ${isBlocked}, trying fallback...`);
          }
        } else if (botResponse.status === 403) {
          console.log(`⚠️ Bot blocked with 403 Forbidden, trying browser fallback...`);
        }
      } catch (botError) {
        console.log(`⚠️ Bot attempt failed: ${botError.message}, trying browser fallback...`);
      }
      
      // ATTEMPT 2: Try with realistic browser headers (fallback for blocked bots)
      if (!htmlContent) {
        console.log(`🌐 ATTEMPT 2: Realistic browser headers (fallback)`);
        
        const browserResponse = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000)
        });
        
        const browserHtml = await browserResponse.text();
        console.log(`🌐 Browser response: HTTP ${browserResponse.status}, HTML length: ${browserHtml.length}`);
        
        // Check if we got blocked/challenged
        const isBlocked = detectBlockedResponse(browserHtml);
        
        // Accept any legitimate response, including error pages
        if (!isBlocked && browserHtml.length > 500) {
          console.log(`✅ Browser fallback successful! Status: ${browserResponse.status}`);
          htmlContent = browserHtml;
          crawlMethod = 'browser-direct';
        } else if (isBlocked) {
          console.log(`⚠️ Browser fallback also blocked: ${isBlocked}`);
        } else {
          console.log(`⚠️ Browser response too short (${browserHtml.length} chars), likely blocked`);
        }
      }
    } catch (directError) {
      console.log(`⚠️ Direct fetch attempts failed: ${directError.message}`);
    }
    
    // STEP 2: If direct fetch failed, use ScraperAPI with ethical bot-first approach
    if (!htmlContent) {
      console.log(`Falling back to ScraperAPI with ethical bot-first strategy...`);
      
      const scraperApiKey = Deno.env.get('SCRAPER_API_KEY') || '';
      if (!scraperApiKey) {
        throw new Error('SCRAPER_API_KEY environment variable is not set');
      }
      
      // Determine if URL is from a protected site and needs special handling
      const isProtectedSite = isProtectedDomain(url);
      
      // Try ScraperAPI with bot headers first
      console.log(`🤖 ScraperAPI with LoudSEOBot headers first: ${url}`);
      
      try {
        // Configure ScraperAPI parameters with bot headers
        const params = new URLSearchParams({
          'api_key': scraperApiKey,
          'url': url,
          'country_code': 'us',
        });
        
        params.set('keep_headers', 'true');
        
        // Add custom LoudSEOBot headers
        const customHeaders = {
          'User-Agent': 'Mozilla/5.0 (compatible; LoudSEOBot/1.0; +https://pageperfect.ai/bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'LoudSEOBot-Key': 'a7b9c3d1-4e8f-4a2b-9c7d-3f1e5a8b9c2d',
          'loud-int': 'true',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'max-age=0'
        };
        
        params.set('custom_headers', JSON.stringify(customHeaders));
        
        // Add premium parameters for protected sites
        if (isProtectedSite) {
          console.log(`Detected protected site: ${url}, using enhanced protection settings`);
          params.set('ultra_premium', 'true');
        } else {
          params.set('ultra_premium', 'true');
        }
        
        // Configure timeout - longer for protected sites
        params.set('timeout', isProtectedSite ? '60000' : '30000');
        
        // Construct the ScraperAPI URL
        const scraperUrl = `http://api.scraperapi.com/?${params.toString()}`;
        
        // Fetch using ScraperAPI with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), isProtectedSite ? 120000 : 60000);
        
        const response = await fetch(scraperUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml'
          },
          redirect: 'follow',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const responseText = await response.text().catch(() => '');
          throw new Error(`Failed to fetch URL via ScraperAPI: ${response.status} ${response.statusText}. Response: ${responseText.substring(0, 200)}`);
        }
        
        htmlContent = await response.text();
        
        // Validate HTML content
        if (!htmlContent || htmlContent.length < 100) {
          throw new Error('Invalid or empty HTML content received');
        }
        
        // Detect common error patterns in the content
        if (htmlContent.includes('CAPTCHA') || htmlContent.includes('captcha')) {
          throw new Error('CAPTCHA detected - site is blocking the request despite ScraperAPI');
        }
        
        if (htmlContent.includes('Access Denied') || htmlContent.includes('403 Forbidden')) {
          throw new Error('Access Denied response received - site is blocking the request');
        }
        
        // Special handling for Oriental Trading - check if it's their standard error page
        if (url.includes('orientaltrading.com') && (
            htmlContent.includes('Something went wrong') || 
            htmlContent.includes('Error Page') ||
            !htmlContent.includes('Oriental Trading'))) {
          throw new Error('Oriental Trading error page received - try using ultra_premium and increasing timeout');
        }
        
        console.log(`✅ ScraperAPI with bot headers successful! HTML length: ${htmlContent.length}`);
        crawlMethod = 'scraperapi-bot';
        
      } catch (error) {
        // Check if it's an abort error (timeout)
        if (error.name === 'AbortError') {
          throw new Error(`Request timed out after ${isProtectedSite ? 120 : 60} seconds`);
        }
        
        // If ScraperAPI with bot headers failed, try with browser headers
        console.log(`⚠️ ScraperAPI with bot headers failed: ${error.message}`);
        console.log(`🌐 Trying ScraperAPI with browser headers as fallback...`);
        
        try {
          // Retry with browser headers via ScraperAPI
          const browserParams = new URLSearchParams({
            'api_key': scraperApiKey,
            'url': url,
            'country_code': 'us',
          });
          
          browserParams.set('keep_headers', 'true');
          
          // Add browser headers for fallback
          const browserHeaders = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'max-age=0',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
          };
          
          browserParams.set('custom_headers', JSON.stringify(browserHeaders));
          browserParams.set('ultra_premium', 'true');
          browserParams.set('timeout', isProtectedSite ? '60000' : '30000');
          
          const browserScraperUrl = `http://api.scraperapi.com/?${browserParams.toString()}`;
          
          const browserController = new AbortController();
          const browserTimeoutId = setTimeout(() => browserController.abort(), isProtectedSite ? 120000 : 60000);
          
          const browserResponse = await fetch(browserScraperUrl, {
            headers: {
              'Accept': 'text/html,application/xhtml+xml'
            },
            redirect: 'follow',
            signal: browserController.signal
          });
          
          clearTimeout(browserTimeoutId);
          
          if (!browserResponse.ok) {
            const responseText = await browserResponse.text().catch(() => '');
            throw new Error(`ScraperAPI browser fallback failed: ${browserResponse.status} ${browserResponse.statusText}. Response: ${responseText.substring(0, 200)}`);
          }
          
          htmlContent = await browserResponse.text();
          
          if (!htmlContent || htmlContent.length < 100) {
            throw new Error('Invalid or empty HTML content from ScraperAPI browser fallback');
          }
          
          console.log(`✅ ScraperAPI browser fallback successful! HTML length: ${htmlContent.length}`);
          crawlMethod = 'scraperapi-browser';
          
        } catch (fallbackError) {
          if (fallbackError.name === 'AbortError') {
            throw new Error(`ScraperAPI browser fallback timed out after ${isProtectedSite ? 120 : 60} seconds`);
          }
          
          throw new Error(`All ScraperAPI attempts failed for ${url}. Bot: ${error.message}, Browser: ${fallbackError.message}`);
        }
      }
    }
    
    // At this point, we should have HTML content
    if (!htmlContent) {
      throw new Error('Failed to fetch HTML content using all available methods');
    }
    
    // Extract canonical URL from HTML
    const canonicalUrl = extractCanonicalUrl(htmlContent, url);
    const finalUrl = canonicalUrl || url; // Use canonical if found, otherwise original
    
    // Log canonical URL discovery
    if (canonicalUrl && canonicalUrl !== url) {
      console.log(`Canonical URL discovered: ${url} -> ${canonicalUrl}`);
    }
    
    // Extract title and description using regex
    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descriptionMatch = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) || 
                            htmlContent.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
    
    const title = titleMatch ? titleMatch[1].trim() : null;
    const description = descriptionMatch ? descriptionMatch[1].trim() : null;

    // Handle URL conflict resolution and database update
    const result = await handleCanonicalUrlUpdate(supabaseClient, url, finalUrl, htmlContent, title, description);

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Page crawled successfully with canonical URL discovery',
        originalUrl: url,
        finalUrl: finalUrl,
        canonicalDiscovered: canonicalUrl && canonicalUrl !== url,
        title,
        description,
        contentLength: htmlContent.length,
        ...result
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    // Return error response
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Helper function to extract canonical URL from HTML
function extractCanonicalUrl(htmlContent: string, originalUrl: string): string | null {
  try {
    // Look for canonical link tag
    const canonicalMatch = htmlContent.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
                          htmlContent.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
    
    if (!canonicalMatch) {
      return null;
    }
    
    let canonicalUrl = canonicalMatch[1].trim();
    
    // Handle relative URLs
    if (canonicalUrl.startsWith('/')) {
      const originalUrlObj = new URL(originalUrl);
      canonicalUrl = `${originalUrlObj.protocol}//${originalUrlObj.host}${canonicalUrl}`;
    } else if (canonicalUrl.startsWith('//')) {
      const originalUrlObj = new URL(originalUrl);
      canonicalUrl = `${originalUrlObj.protocol}${canonicalUrl}`;
    }
    
    // Validate the canonical URL
    try {
      new URL(canonicalUrl);
    } catch (error) {
      console.log(`Invalid canonical URL found: ${canonicalUrl}`);
      return null;
    }
    
    // Don't use canonical if it's the same as original (after normalization)
    if (normalizeUrl(canonicalUrl) === normalizeUrl(originalUrl)) {
      return null;
    }
    
    return canonicalUrl;
  } catch (error) {
    console.log(`Error extracting canonical URL: ${error.message}`);
    return null;
  }
}

// Helper function to normalize URLs for comparison
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash and convert to lowercase
    return `${urlObj.protocol}//${urlObj.host.toLowerCase()}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}`;
  } catch (error) {
    return url;
  }
}

// Helper function to handle canonical URL update and conflict resolution
async function handleCanonicalUrlUpdate(
  supabaseClient: any,
  originalUrl: string,
  finalUrl: string,
  htmlContent: string,
  title: string | null,
  description: string | null
): Promise<any> {
  const canonicalDiscovered = finalUrl !== originalUrl;
  
  if (!canonicalDiscovered) {
    // No canonical URL found, use standard upsert
    const { data, error } = await supabaseClient
      .from('pages')
      .upsert({
        url: finalUrl,
        html: htmlContent,
        title,
        description,
        last_crawled: new Date().toISOString(),
      }, {
        onConflict: 'url'
      });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }
    
    return { action: 'updated_existing_page' };
  }
  
  // Canonical URL discovered - need to handle potential conflicts
  
  // First, check if canonical URL already exists
  const { data: existingCanonical, error: canonicalError } = await supabaseClient
    .from('pages')
    .select('id, url, original_url, title, description, html, last_crawled')
    .eq('url', finalUrl)
    .single();
    
  if (canonicalError && canonicalError.code !== 'PGRST116') { // PGRST116 is "not found"
    throw new Error(`Error checking for existing canonical URL: ${canonicalError.message}`);
  }
  
  // Check if original URL already exists
  const { data: existingOriginal, error: originalError } = await supabaseClient
    .from('pages')
    .select('id, url, original_url, title, description, html, last_crawled')
    .eq('url', originalUrl)
    .single();
    
  if (originalError && originalError.code !== 'PGRST116') {
    throw new Error(`Error checking for existing original URL: ${originalError.message}`);
  }
  
  if (existingCanonical && existingOriginal) {
    // Both URLs exist as separate pages - need to merge
    console.log(`Merging pages: ${originalUrl} -> ${finalUrl}`);
    
    // Update the original page record to use canonical URL
    const { error: updateError } = await supabaseClient
      .from('pages')
      .update({
        url: finalUrl,
        html: htmlContent,
        title: title || existingOriginal.title,
        description: description || existingOriginal.description,
        original_url: originalUrl,
        canonical_discovered_at: new Date().toISOString(),
        last_crawled: new Date().toISOString(),
      })
      .eq('id', existingOriginal.id);
      
    if (updateError) {
      throw new Error(`Error updating original page: ${updateError.message}`);
    }
    
    // Delete the duplicate canonical page if it exists
    const { error: deleteError } = await supabaseClient
      .from('pages')
      .delete()
      .eq('id', existingCanonical.id);
      
    if (deleteError) {
      console.log(`Warning: Could not delete duplicate canonical page: ${deleteError.message}`);
    }
    
    return { action: 'merged_pages', originalId: existingOriginal.id, deletedId: existingCanonical.id };
    
  } else if (existingOriginal) {
    // Only original URL exists - update it to use canonical
    const { error: updateError } = await supabaseClient
      .from('pages')
      .update({
        url: finalUrl,
        html: htmlContent,
        title: title || existingOriginal.title,
        description: description || existingOriginal.description,
        original_url: originalUrl,
        canonical_discovered_at: new Date().toISOString(),
        last_crawled: new Date().toISOString(),
      })
      .eq('id', existingOriginal.id);
      
    if (updateError) {
      throw new Error(`Error updating page with canonical URL: ${updateError.message}`);
    }
    
    return { action: 'updated_with_canonical', pageId: existingOriginal.id };
    
  } else if (existingCanonical) {
    // Only canonical URL exists - update it
    const { error: updateError } = await supabaseClient
      .from('pages')
      .update({
        html: htmlContent,
        title: title || existingCanonical.title,
        description: description || existingCanonical.description,
        original_url: existingCanonical.original_url || originalUrl,
        canonical_discovered_at: existingCanonical.canonical_discovered_at || new Date().toISOString(),
        last_crawled: new Date().toISOString(),
      })
      .eq('id', existingCanonical.id);
      
    if (updateError) {
      throw new Error(`Error updating existing canonical page: ${updateError.message}`);
    }
    
    return { action: 'updated_canonical_page', pageId: existingCanonical.id };
    
  } else {
    // Neither URL exists - create new page with canonical URL
    const { data, error } = await supabaseClient
      .from('pages')
      .insert({
        url: finalUrl,
        html: htmlContent,
        title,
        description,
        original_url: originalUrl,
        canonical_discovered_at: new Date().toISOString(),
        last_crawled: new Date().toISOString(),
      })
      .select()
      .single();
      
    if (error) {
      throw new Error(`Error creating new page with canonical URL: ${error.message}`);
    }
    
    return { action: 'created_new_page', pageId: data.id };
  }
}

// Helper function to check if a URL is from a known protected site
function isProtectedDomain(url: string): boolean {
  // Create a URL object to extract the hostname
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    // List of known protected sites with bot detection or heavy protection
    const protectedDomains = [
      'orientaltrading.com',
      'wayfair.com',
      'homedepot.com',
      'walmart.com',
      'target.com',
      'bestbuy.com',
      'lowes.com',
      'amazon.com',
      'airbnb.com',
      'booking.com',
      'etsy.com',
      'zillow.com',
      'redfin.com',
      'indeed.com',
      'glassdoor.com',
      'yelp.com',
      'tripadvisor.com',
      'vrbo.com',
      'kayak.com',
      'expedia.com',
      'chewy.com',
      'macys.com',
      'costco.com',
      'nordstrom.com'
    ];
    
    // Check if hostname contains any of the protected domains
    return protectedDomains.some(domain => hostname.includes(domain));
  } catch (error) {
    console.error('Error parsing URL:', error);
    return false;
  }
}

// Helper function to check if a URL is from an OTC domain that needs custom headers
function isOTCDomain(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
    // OTC domains that need custom LoudSEOBot headers
    const otcDomains = [
      'halloweenexpress.com',
      'smilemakers.com',
      'smilemakers.ca',
      'mindware.com',
      'mindware.orientaltrading.com',
      'funexpress.com'
    ];
    
    // Check if hostname matches any of the OTC domains
    return otcDomains.some(domain => hostname.includes(domain));
  } catch (error) {
    console.error('Error parsing URL for OTC domain check:', error);
    return false;
  }
}

// Helper function to detect if a response is blocked (CAPTCHA, challenge, etc.)
function detectBlockedResponse(html: string): string | null {
  if (!html) return 'Empty response';
  
  const htmlLower = html.toLowerCase();
  
  // Extract title for checking
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].toLowerCase() : '';
  
  // Common CAPTCHA page title patterns
  const captchaTitlePatterns = [
    'just a moment',
    'attention required',
    'checking your browser',
    'please verify',
    'security check',
    'access denied',
    'error 1020',
    'one more step',
    'are you human',
    'verify you are human',
    'ddos protection'
  ];
  
  // Check title first - most reliable indicator
  for (const pattern of captchaTitlePatterns) {
    if (title.includes(pattern)) {
      return `Challenge page detected: "${pattern}" in title`;
    }
  }
  
  // Cloudflare specific patterns - these are definitive challenge pages
  if ((htmlLower.includes('cf-browser-verification') && html.length < 10000) ||
      htmlLower.includes('cf_chl_opt') ||
      htmlLower.includes('cf-challenge-error-text') ||
      htmlLower.includes('cf-chl-managed')) {
    return 'Cloudflare challenge detected';
  }
  
  // Check for challenge body patterns WITH short content
  // This avoids false positives on legitimate pages
  if (html.length < 10000) {  // Challenge pages are typically very short
    const challengeBodyPatterns = [
      'checking your browser before accessing',
      'this process is automatic',
      'your browser will redirect',
      'please complete the security check',
      'enable cookies and reload',
      'why do i have to complete a captcha'
    ];
    
    for (const pattern of challengeBodyPatterns) {
      if (htmlLower.includes(pattern)) {
        return `Challenge page detected: "${pattern}"`;
      }
    }
  }
  
  // Specific CAPTCHA challenges (not just analytics scripts)
  // The challenge-platform script alone isn't enough - need more indicators
  if (htmlLower.includes('challenge-platform') && 
      htmlLower.includes('cloudflare') &&
      (htmlLower.includes('cf-challenge') || 
       htmlLower.includes('cf-browser-verification') ||
       html.length < 20000)) {
    return 'Cloudflare interactive challenge';
  }
  
  // Check for actual CAPTCHA challenge pages (not embedded forms)
  if (html.length < 5000 && htmlLower.includes('captcha') && !htmlLower.includes('product')) {
    return 'CAPTCHA challenge page';
  }
  
  // Access denied pages with minimal content
  if (html.length < 5000 && (
      htmlLower.includes('403 forbidden') ||
      htmlLower.includes('access denied') ||
      htmlLower.includes('permission denied'))) {
    return 'Access denied page';
  }
  
  // Bot detection pages
  if (htmlLower.includes('bot detection') && html.length < 10000) {
    return 'Bot detection page';
  }
  
  // Rate limiting pages
  if (title.includes('rate limit') || 
      (htmlLower.includes('429 too many requests') && html.length < 5000)) {
    return 'Rate limited';
  }
  
  // If we see legitimate e-commerce indicators, it's probably not blocked
  const legitimateIndicators = [
    'add to cart',
    'product-info',
    'price',
    'in stock',
    'quantity'
  ];
  
  const hasLegitimateContent = legitimateIndicators.some(indicator => 
    htmlLower.includes(indicator)
  );
  
  if (hasLegitimateContent && html.length > 20000) {
    // This is likely a legitimate page with embedded reCAPTCHA
    return null;
  }
  
  // If no definitive blocking patterns found, return null
  return null;
}