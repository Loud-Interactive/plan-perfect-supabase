// PagePerfect: crawl-page-html-enhanced  
// Enhanced function with canonical URL detection, redirect following, and HTTP status validation
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { processHtmlContent, cleanText } from '../_shared/encoding-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  url: string;
}

interface CrawlResult {
  success: boolean;
  originalUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  httpStatus: number;
  contentLength: number;
  html?: string;
  title?: string;
  description?: string;
  redirectChain: string[];
  crawlMethod: string;
  error?: string;
  crossDomainCanonical?: string;
  pageId?: number;
  createdAt?: string;
  updatedAt?: string;
  cached?: boolean;
  cacheAge?: number; // Age in days
}

const MAX_REDIRECTS = 5;

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
    let originalUrlObj: URL;
    try {
      originalUrlObj = new URL(url);
    } catch (error) {
      throw new Error('Invalid URL format');
    }

    console.log(`🔍 Enhanced crawling URL: ${url}`);

    // STEP 0: Check if we have recent cached data (within 2 weeks)
    try {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const twoWeeksAgoISO = twoWeeksAgo.toISOString();
      
      console.log(`📦 Checking for cached data newer than ${twoWeeksAgoISO}...`);
      
      const { data: cachedPage, error: cacheError } = await supabaseClient
        .from('pages')
        .select('id, url, html, html_length, title, description, http_status, canonical_url, original_url, redirect_chain, last_crawled, created_at, updated_at')
        .eq('url', url)
        .gte('last_crawled', twoWeeksAgoISO)
        .not('html', 'is', null)
        .single();
      
      if (!cacheError && cachedPage && cachedPage.html && cachedPage.html.length > 100) {
        console.log(`✅ Found fresh cached data from ${cachedPage.last_crawled} (Page ID: ${cachedPage.id})`);
        console.log(`   - HTTP Status: ${cachedPage.http_status || 'N/A'}`);
        console.log(`   - HTML Length: ${cachedPage.html_length || cachedPage.html.length} chars`);
        console.log(`   - Using cached data instead of re-crawling`);
        
        // Return cached data with full page information
        return new Response(
          JSON.stringify({
            success: true,
            originalUrl: url,
            finalUrl: cachedPage.url,
            canonicalUrl: cachedPage.canonical_url || cachedPage.url,
            httpStatus: cachedPage.http_status || 200,
            contentLength: cachedPage.html_length || cachedPage.html.length,
            html: cachedPage.html,
            title: cachedPage.title,
            description: cachedPage.description,
            redirectChain: cachedPage.redirect_chain || [],
            crawlMethod: 'cached',
            pageId: cachedPage.id,
            createdAt: cachedPage.created_at,
            updatedAt: cachedPage.updated_at,
            cached: true,
            cacheAge: Math.floor((Date.now() - new Date(cachedPage.last_crawled).getTime()) / 1000 / 60 / 60 / 24) // Age in days
          }),
          {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'X-Cache': 'HIT',
              'X-Cache-Age': cachedPage.last_crawled
            },
          }
        );
      } else {
        console.log(`📭 No fresh cached data found, proceeding with crawl`);
        if (cacheError && cacheError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
          console.log(`   Cache check error: ${cacheError.message}`);
        }
      }
    } catch (cacheCheckError) {
      console.log(`⚠️ Cache check failed: ${cacheCheckError.message}, proceeding with crawl`);
    }

    const result: CrawlResult = {
      success: false,
      originalUrl: url,
      finalUrl: url,
      canonicalUrl: url,
      httpStatus: 0,
      contentLength: 0,
      redirectChain: [],
      crawlMethod: 'enhanced-direct'
    };

    // STEP 1: Try direct fetch with redirect following and status tracking
    let htmlContent: string | null = null;
    let finalResponse: Response | null = null;
    
    try {
      console.log(`🚀 Attempting enhanced direct fetch...`);
      
      const { response, redirectChain } = await fetchWithRedirectTracking(url);
      finalResponse = response;
      result.redirectChain = redirectChain;
      result.finalUrl = response.url;
      result.httpStatus = response.status;

      console.log(`📊 Final status: ${response.status}, Redirects: ${redirectChain.length}`);

      // Only proceed if we got a successful response
      if (response.status === 200) {
        const directHtml = await response.text();
        
        // Check if we got blocked/challenged
        const isBlocked = detectBlockedResponse(directHtml);
        
        if (!isBlocked) {
          console.log(`✅ Direct fetch successful! Status: ${response.status}, HTML length: ${directHtml.length}`);
          htmlContent = directHtml;
          result.crawlMethod = 'enhanced-direct';
        } else {
          console.log(`⚠️ Direct fetch blocked: ${isBlocked}`);
        }
      } else {
        console.log(`⚠️ Non-200 status received: ${response.status}`);
        // For non-200 status, we'll note it but not proceed with SEO
      }
    } catch (directError) {
      console.log(`⚠️ Direct fetch error: ${directError.message}`);
    }
    
    // STEP 2: If direct fetch failed, try ScraperAPI
    if (!htmlContent && result.httpStatus !== 200) {
      console.log(`🔧 Falling back to ScraperAPI...`);
      
      try {
        const scraperResult = await fetchViaScraperAPI(url);
        htmlContent = scraperResult.html;
        result.crawlMethod = 'enhanced-scraperapi';
        result.httpStatus = scraperResult.status;
        result.finalUrl = scraperResult.finalUrl;
        
        console.log(`✅ ScraperAPI successful! Status: ${scraperResult.status}, HTML length: ${htmlContent?.length || 0}`);
      } catch (scraperError) {
        console.log(`❌ ScraperAPI also failed: ${scraperError.message}`);
        result.error = scraperError.message;
      }
    }
    
    // STEP 3: If we have HTML content, process canonical URL
    if (htmlContent && result.httpStatus === 200) {
      console.log(`🔍 Processing canonical URL...`);
      
      const canonicalUrl = extractCanonicalUrl(htmlContent, result.finalUrl);
      
      if (canonicalUrl && canonicalUrl !== result.finalUrl) {
        const canonicalDomain = new URL(canonicalUrl).hostname;
        const finalDomain = new URL(result.finalUrl).hostname;
        
        if (canonicalDomain === finalDomain) {
          // Same domain - fetch canonical content
          console.log(`🎯 Found same-domain canonical: ${canonicalUrl}`);
          
          try {
            const canonicalResult = await fetchWithRedirectTracking(canonicalUrl);
            if (canonicalResult.response.status === 200) {
              const canonicalHtml = await canonicalResult.response.text();
              if (!detectBlockedResponse(canonicalHtml)) {
                htmlContent = canonicalHtml;
                result.canonicalUrl = canonicalUrl;
                result.finalUrl = canonicalResult.response.url;
                console.log(`✅ Using canonical content from: ${canonicalUrl}`);
              }
            }
          } catch (canonicalError) {
            console.log(`⚠️ Failed to fetch canonical URL, using original: ${canonicalError.message}`);
            result.canonicalUrl = result.finalUrl; // Fall back to final URL
          }
        } else {
          // Cross-domain canonical - just note it
          console.log(`🌐 Cross-domain canonical detected: ${canonicalUrl} (not following)`);
          result.crossDomainCanonical = canonicalUrl;
          result.canonicalUrl = result.finalUrl;
        }
      } else {
        result.canonicalUrl = result.finalUrl;
      }
      
      // Process HTML content
      htmlContent = processHtmlContent(htmlContent);
      result.contentLength = htmlContent.length;
      result.html = htmlContent;
      
      // Extract title and description
      const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i);
      const descriptionMatch = htmlContent.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) || 
                              htmlContent.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
      
      result.title = titleMatch ? cleanText(titleMatch[1].trim()) : undefined;
      result.description = descriptionMatch ? cleanText(descriptionMatch[1].trim()) : undefined;
      
      result.success = true;
    }

    // STEP 4: Store in database with enhanced fields
    if (result.success && htmlContent) {
      console.log(`💾 Storing enhanced data in database...`);
      
      try {
        const { data: pageData, error } = await supabaseClient
          .from('pages')
          .upsert({
            url: result.canonicalUrl, // Store canonical URL as the main URL
            original_url: result.originalUrl !== result.canonicalUrl ? result.originalUrl : null,
            canonical_url: result.canonicalUrl,
            http_status: result.httpStatus,
            redirect_chain: result.redirectChain,
            html: htmlContent,
            html_length: result.contentLength,
            title: result.title,
            description: result.description,
            last_crawled: new Date().toISOString(),
          }, {
            onConflict: 'url'
          })
          .select('id, url, created_at, updated_at');

        if (error) {
          console.log(`⚠️ Database error (columns may not exist yet): ${error.message}`);
          
          // Fallback: store without enhanced fields
          const { data: fallbackData, error: fallbackError } = await supabaseClient
            .from('pages')
            .upsert({
              url: result.canonicalUrl,
              html: htmlContent,
              html_length: result.contentLength,
              title: result.title,
              description: result.description,
              last_crawled: new Date().toISOString(),
            }, {
              onConflict: 'url'
            })
            .select('id, url, created_at, updated_at');
          
          if (!fallbackError && fallbackData && fallbackData.length > 0) {
            result.pageId = fallbackData[0].id;
            result.createdAt = fallbackData[0].created_at;
            result.updatedAt = fallbackData[0].updated_at;
            console.log(`✅ Stored with basic fields (enhanced fields need to be added to schema) - Page ID: ${result.pageId}`);
          } else {
            console.log(`⚠️ Fallback also had issues, but page may have been stored`);
          }
        } else if (pageData && pageData.length > 0) {
          result.pageId = pageData[0].id;
          result.createdAt = pageData[0].created_at;
          result.updatedAt = pageData[0].updated_at;
          console.log(`✅ Stored with enhanced canonical tracking - Page ID: ${result.pageId}`);
        }
      } catch (dbError) {
        console.error(`❌ Database error: ${dbError}`);
      }
    }

    // Return enhanced response
    return new Response(
      JSON.stringify(result),
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
        originalUrl: '',
        finalUrl: '',
        canonicalUrl: '',
        httpStatus: 0,
        contentLength: 0,
        redirectChain: [],
        crawlMethod: 'error'
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

// Enhanced fetch with ethical bot-first strategy and fallbacks
async function fetchWithRedirectTracking(url: string) {
  console.log(`🔄 Starting ethical bot-first fetch: ${url}`);
  
  // ATTEMPT 1: Try with proper LoudSEOBot identification (ethical/compliance requirement)
  try {
    console.log(`🤖 Attempt 1: Trying with LoudSEOBot identification...`);
    
    const botResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LoudSEOBot/1.0; +https://pageperfect.ai/bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'LoudSEOBot-Key': 'a7b9c3d1-4e8f-4a2b-9c7d-3f1e5a8b9c2d',
        'loud-int': 'true',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    
    // If we get a successful response or acceptable error (not blocking), use it
    if (botResponse.status === 200 || (botResponse.status >= 400 && botResponse.status < 500 && botResponse.status !== 403)) {
      const redirectChain: string[] = [];
      if (botResponse.url !== url) {
        redirectChain.push(`Redirected to ${botResponse.url}`);
        console.log(`📍 Bot redirect: ${url} → ${botResponse.url}`);
      }
      
      console.log(`✅ Bot identification successful: ${botResponse.status} ${botResponse.url}`);
      return { response: botResponse, redirectChain };
    }
    
    // If we get 403 or other blocking status, try fallback
    if (botResponse.status === 403 || botResponse.status === 429) {
      console.log(`⚠️ Bot blocked (${botResponse.status}), trying browser fallback...`);
    }
    
  } catch (botError) {
    console.log(`⚠️ Bot attempt failed: ${botError.message}, trying browser fallback...`);
  }
  
  // ATTEMPT 2: Try with realistic browser headers (fallback for blocked bots)
  try {
    console.log(`🌐 Attempt 2: Trying with realistic browser headers...`);
    
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
        'Cache-Control': 'max-age=0'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });
    
    const redirectChain: string[] = [];
    if (browserResponse.url !== url) {
      redirectChain.push(`Redirected to ${browserResponse.url}`);
      console.log(`📍 Browser redirect: ${url} → ${browserResponse.url}`);
    }
    
    console.log(`✅ Browser fallback successful: ${browserResponse.status} ${browserResponse.url}`);
    return { response: browserResponse, redirectChain };
    
  } catch (browserError) {
    console.log(`❌ Browser fallback also failed: ${browserError.message}`);
    throw browserError;
  }
}

// Fetch via ScraperAPI with ethical bot-first strategy
async function fetchViaScraperAPI(url: string) {
  const scraperApiKey = Deno.env.get('SCRAPER_API_KEY') || '';
  if (!scraperApiKey) {
    throw new Error('SCRAPER_API_KEY environment variable is not set');
  }
  
  const isProtectedSite = isProtectedDomain(url);
  console.log(`🔧 ScraperAPI attempt for: ${url} (protected: ${isProtectedSite})`);
  
  // ATTEMPT 1: Try ScraperAPI with LoudSEOBot identification
  try {
    console.log(`🤖 ScraperAPI Attempt 1: With LoudSEOBot identification...`);
    
    const botParams = new URLSearchParams({
      'api_key': scraperApiKey,
      'url': url,
      'country_code': 'us',
      'keep_headers': 'true',
      'render': 'true',
      'timeout': isProtectedSite ? '60000' : '30000'
    });
    
    const botHeaders = {
      'User-Agent': 'Mozilla/5.0 (compatible; LoudSEOBot/1.0; +https://pageperfect.ai/bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'LoudSEOBot-Key': 'a7b9c3d1-4e8f-4a2b-9c7d-3f1e5a8b9c2d',
      'loud-int': 'true',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    };
    
    botParams.set('custom_headers', JSON.stringify(botHeaders));
    
    if (isProtectedSite) {
      botParams.set('ultra_premium', 'true');
    }
    
    const botScraperUrl = `http://api.scraperapi.com/?${botParams.toString()}`;
    const botResponse = await fetch(botScraperUrl, {
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(isProtectedSite ? 120000 : 60000)
    });
    
    if (botResponse.ok) {
      const botHtml = await botResponse.text();
      
      if (botHtml && botHtml.length >= 100) {
        const blockReason = detectBlockedResponse(botHtml);
        if (!blockReason) {
          console.log(`✅ ScraperAPI bot identification successful`);
          return {
            html: processHtmlContent(botHtml),
            status: 200,
            finalUrl: url
          };
        } else {
          console.log(`⚠️ ScraperAPI bot content blocked: ${blockReason}, trying browser fallback...`);
        }
      }
    } else {
      console.log(`⚠️ ScraperAPI bot failed: ${botResponse.status}, trying browser fallback...`);
    }
    
  } catch (botError) {
    console.log(`⚠️ ScraperAPI bot attempt failed: ${botError.message}, trying browser fallback...`);
  }
  
  // ATTEMPT 2: Try ScraperAPI with browser headers (fallback)
  console.log(`🌐 ScraperAPI Attempt 2: With browser headers...`);
  
  const browserParams = new URLSearchParams({
    'api_key': scraperApiKey,
    'url': url,
    'country_code': 'us',
    'keep_headers': 'true',
    'render': 'true',
    'timeout': isProtectedSite ? '60000' : '30000'
  });
  
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'max-age=0'
  };
  
  browserParams.set('custom_headers', JSON.stringify(browserHeaders));
  
  if (isProtectedSite) {
    browserParams.set('ultra_premium', 'true');
  }
  
  const browserScraperUrl = `http://api.scraperapi.com/?${browserParams.toString()}`;
  const response = await fetch(browserScraperUrl, {
    headers: { 'Accept': 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(isProtectedSite ? 120000 : 60000)
  });
  
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`ScraperAPI browser fallback failed: ${response.status} ${response.statusText}. ${responseText.substring(0, 200)}`);
  }
  
  const html = await response.text();
  
  if (!html || html.length < 100) {
    throw new Error('Invalid or empty HTML content from ScraperAPI browser fallback');
  }
  
  const blockReason = detectBlockedResponse(html);
  if (blockReason) {
    throw new Error(`ScraperAPI browser fallback content blocked: ${blockReason}`);
  }
  
  console.log(`✅ ScraperAPI browser fallback successful`);
  return {
    html: processHtmlContent(html),
    status: 200, // ScraperAPI abstracts the actual status
    finalUrl: url  // ScraperAPI doesn't provide redirect tracking
  };
}

// Extract canonical URL from HTML
function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  // Look for canonical link tag
  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i) ||
                         html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  
  if (canonicalMatch) {
    const canonicalHref = canonicalMatch[1].trim();
    
    try {
      // Convert relative URL to absolute
      return new URL(canonicalHref, fallbackUrl).toString();
    } catch (error) {
      console.log(`⚠️ Invalid canonical URL: ${canonicalHref}`);
    }
  }
  
  return fallbackUrl;
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
  
  // Cloudflare specific patterns
  if ((htmlLower.includes('cf-browser-verification') && html.length < 10000) ||
      htmlLower.includes('cf_chl_opt') ||
      htmlLower.includes('cf-challenge-error-text') ||
      htmlLower.includes('cf-chl-managed')) {
    return 'Cloudflare challenge detected';
  }
  
  // Challenge body patterns with short content
  if (html.length < 10000) {
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
    return null;
  }
  
  return null;
}

// Helper function to check if a URL is from a known protected site
function isProtectedDomain(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    
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
      'smilemakers.com',
      'smilemakers.ca',
      'mindware.com',
      'funexpress.com'
    ];
    
    return protectedDomains.some(domain => hostname.includes(domain));
  } catch (error) {
    console.error('Error parsing URL:', error);
    return false;
  }
}