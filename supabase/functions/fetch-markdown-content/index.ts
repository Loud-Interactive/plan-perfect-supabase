// supabase/functions/fetch-markdown-content/index.ts
// Enhanced function to fetch content and convert to markdown
// Uses Jina AI Reader API first, falls back to ScraperAPI, then Markdowner API as final fallback
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { cleanText, processHtmlContent } from '../_shared/encoding-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface RequestBody {
  url: string;
  use_fallback?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Parse request
    const { url, use_fallback = false } = await req.json() as RequestBody;

    if (!url) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check if URL is valid
    try {
      new URL(url);
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Converting URL to Markdown: ${url}`);

    let markdown = '';
    let method = '';

    // Try Jina AI first, then ScraperAPI, then Markdowner as final fallback
    try {
      // Try Jina AI Reader API first
      console.log('Attempting to convert URL to Markdown using Jina AI Reader API...');
      const jinaApiUrl = `https://r.jina.ai/${url}`;
      const jinaApiKey = Deno.env.get('JINA_API_KEY') || 'jina_335b0361bef84b3694f1f8f23184b552j_S3s2fdN5mu5w3DXzq54O9DtCBe';
      
      const jinaResponse = await fetch(jinaApiUrl, {
        headers: {
          'Authorization': `Bearer ${jinaApiKey}`
        }
      });

      if (jinaResponse.ok) {
        markdown = await jinaResponse.text();
        method = 'jina_ai';
        console.log(`Successfully converted URL to Markdown using Jina AI (${markdown.length} characters)`);
      } else {
        const errorText = await jinaResponse.text();
        console.warn(`Jina AI failed: ${jinaResponse.status} ${jinaResponse.statusText} - ${errorText}`);
        throw new Error(`Jina AI failed: ${jinaResponse.statusText} - ${errorText}`);
      }
    } catch (jinaError) {
      console.warn(`Jina AI conversion failed: ${jinaError.message}`);
      
      // Fallback to ScraperAPI (unless use_fallback flag is set)
      if (use_fallback) {
        console.log('use_fallback flag is set, skipping ScraperAPI and going directly to Markdowner API...');
        try {
          markdown = await fetchWithMarkdownerAPI(url);
          method = 'markdowner_fallback';
          console.log(`Successfully converted URL to Markdown using Markdowner API (${markdown.length} characters)`);
        } catch (markdownerError) {
          console.error(`All conversion methods failed. Jina: ${jinaError.message}, Markdowner: ${markdownerError.message}`);
          throw new Error(`Failed to convert URL to markdown with all services. Jina: ${jinaError.message}, Markdowner: ${markdownerError.message}`);
        }
      } else {
        // Try ScraperAPI second
        try {
          console.log('Trying ScraperAPI...');
          const htmlContent = await fetchWithScraperAPI(url);
          markdown = htmlToMarkdown(htmlContent);
          method = 'scraperapi';
          console.log(`Successfully converted URL to Markdown using ScraperAPI (${markdown.length} characters)`);
        } catch (scraperError) {
          console.warn(`ScraperAPI failed: ${scraperError.message}, falling back to Markdowner API...`);
          
          // Final fallback to Markdowner API
          try {
            markdown = await fetchWithMarkdownerAPI(url);
            method = 'markdowner_fallback';
            console.log(`Successfully converted URL to Markdown using Markdowner API (${markdown.length} characters)`);
          } catch (markdownerError) {
            console.error(`All conversion methods failed. Jina: ${jinaError.message}, ScraperAPI: ${scraperError.message}, Markdowner: ${markdownerError.message}`);
            throw new Error(`Failed to convert URL to markdown with all services. Jina: ${jinaError.message}, ScraperAPI: ${scraperError.message}, Markdowner: ${markdownerError.message}`);
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      markdown,
      length: markdown.length,
      method,
      url
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("Error converting URL to markdown:", error);
    
    return new Response(JSON.stringify({ 
      error: `Error converting URL to markdown: ${error.message}` 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Function to fetch HTML using ScraperAPI
async function fetchWithScraperAPI(url: string): Promise<string> {
  const scraperApiKey = Deno.env.get('SCRAPER_API_KEY') || '';
  if (!scraperApiKey) {
    throw new Error('SCRAPER_API_KEY environment variable is not set');
  }
  
  // Determine if URL is from a protected site and needs special handling
  const isProtectedSite = isProtectedDomain(url);
  
  // Configure ScraperAPI parameters - always use ultra premium and rendering
  const params = new URLSearchParams({
    'api_key': scraperApiKey,
    'url': url,
    'country_code': 'us',
    'ultra_premium': 'true',
    'render': 'true'
  });
  
  // Configure timeout - longer for protected sites
  params.set('timeout', isProtectedSite ? '60000' : '30000');
  
  // Construct the ScraperAPI URL - use HTTPS
  const scraperUrl = `https://api.scraperapi.com/?${params.toString()}`;
  
  console.log(`Making ScraperAPI request to: ${url}`);
  console.log(`ScraperAPI URL: ${scraperUrl}`);
  console.log(`Is protected site: ${isProtectedSite}`);
  
  // Fetch using ScraperAPI with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), isProtectedSite ? 120000 : 60000);
  
  try {
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
    
    let htmlContent = await response.text();
    
    console.log(`ScraperAPI response length: ${htmlContent.length} characters`);
    console.log(`ScraperAPI response preview: ${htmlContent.substring(0, 500)}`);
    
    // Process the HTML content to fix encoding issues
    htmlContent = processHtmlContent(htmlContent);
    
    // Validate HTML content
    if (!htmlContent || htmlContent.length < 100) {
      throw new Error('Invalid or empty HTML content received');
    }
    
    // More specific error detection
    const lowerContent = htmlContent.toLowerCase();
    
    /*if (lowerContent.includes('captcha')) {
      console.log('CAPTCHA detected in response');
      throw new Error('CAPTCHA detected - site is blocking the request despite ScraperAPI');
    }*/
    
    if (lowerContent.includes('access denied') || lowerContent.includes('403 forbidden')) {
      console.log('Access denied detected in response');
      throw new Error('Access Denied response received - site is blocking the request');
    }
    
    // Check for ScraperAPI error responses
    if (lowerContent.includes('scraperapi') && lowerContent.includes('error')) {
      console.log('ScraperAPI error detected in response');
      throw new Error('ScraperAPI returned an error response');
    }
    
    // Check if it looks like actual content (has HTML tags)
    if (!htmlContent.includes('<html') && !htmlContent.includes('<body') && !htmlContent.includes('<div')) {
      console.log('Response does not appear to contain HTML content');
      throw new Error('Response does not contain valid HTML content');
    }
    
    console.log('ScraperAPI response appears valid');
    return htmlContent;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Check if it's an abort error (timeout)
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${isProtectedSite ? 120 : 60} seconds`);
    }
    
    // Re-throw with more context
    throw new Error(`ScraperAPI fetch error for ${url}: ${error.message}`);
  }
}

// Function to fetch markdown using the original Markdowner API
async function fetchWithMarkdownerAPI(url: string): Promise<string> {
  const markdownerApiUrl = `https://md.dhr.wtf/?url=${encodeURIComponent(url)}`;
  const markdownResponse = await fetch(markdownerApiUrl, {
    headers: {
      'Authorization': 'Bearer LWdIbnQ4UXhDc0dwX1BvLXNBSEVaLTI='
    }
  });
  
  if (!markdownResponse.ok) {
    const errorText = await markdownResponse.text();
    console.error("Markdowner API error:", markdownResponse.status, errorText);
    throw new Error(`Failed to convert URL to markdown: ${markdownResponse.status} - ${markdownResponse.statusText}`);
  }
  
  let markdown = await markdownResponse.text();
  console.log(`Successfully converted URL to Markdown using Markdowner API (${markdown.length} characters)`);
  
  // Clean the markdown text to fix any encoding issues
  markdown = cleanText(markdown);
  
  return markdown;
}

// Simple HTML to Markdown converter
function htmlToMarkdown(html: string): string {
  // First clean the HTML content to fix encoding issues
  let markdown = processHtmlContent(html);
  
  // Remove script and style tags completely
  markdown = markdown.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  markdown = markdown.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Convert headings
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
  
  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Convert links
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Convert bold and italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  
  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, content) => {
    const items = content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    return items + '\n';
  });
  
  markdown = markdown.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (match, content) => {
    let counter = 1;
    const items = content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${counter++}. $1\n`);
    return items + '\n';
  });
  
  // Convert line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');
  
  // Convert blockquotes
  markdown = markdown.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '> $1\n\n');
  
  // Convert code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '```\n$1\n```\n\n');
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  
  // Convert images
  markdown = markdown.replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, '![$2]($1)');
  markdown = markdown.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, '![$1]($2)');
  markdown = markdown.replace(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)');
  
  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]*>/g, '');
  
  // The HTML entities are already decoded by processHtmlContent
  // Just do a final cleanup with cleanText
  markdown = cleanText(markdown, {
    decodeEntities: false, // Already done by processHtmlContent
    fixMojibake: true,
    normalizeUnicode: true,
    removeReplacementChars: true
  });
  
  // Clean up extra whitespace
  markdown = markdown.replace(/\n\s*\n\s*\n/g, '\n\n');
  markdown = markdown.replace(/^\s+|\s+$/g, '');
  
  // Ensure there's content
  if (markdown.length < 50) {
    throw new Error('Converted markdown content is too short - the page may not have loaded properly');
  }
  
  return markdown;
}

// Helper function to check if a URL is from a known protected site
function isProtectedDomain(url: string): boolean {
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
      'nordstrom.com',
      'trisearch.com'
    ];
    
    // Check if hostname contains any of the protected domains
    return protectedDomains.some(domain => hostname.includes(domain));
  } catch (error) {
    console.error('Error parsing URL:', error);
    return false;
  }
}
