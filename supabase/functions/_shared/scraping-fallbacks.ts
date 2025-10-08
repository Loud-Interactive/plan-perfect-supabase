// Scraping Fallback Chain - Multiple strategies for resilient web scraping
// Provides fallback options when primary scraping methods fail

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CircuitBreaker, createCircuitBreaker } from "./circuit-breaker.ts";
import { retryExternalAPI } from "./retry-strategies.ts";
import { processHtmlContent, cleanText, decodeHtmlEntities } from "./encoding-utils.ts";

export interface ScrapingResult {
  html: string;
  method: string;
  metadata?: {
    statusCode?: number;
    contentLength?: number;
    contentType?: string;
    responseTime?: number;
    fromCache?: boolean;
  };
}

export interface ScrapingOptions {
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  followRedirects?: boolean;
  maxRedirects?: number;
}

export class ScrapingFallbackChain {
  private supabase: SupabaseClient;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  
  // Default scraping options
  private defaultOptions: Required<ScrapingOptions> = {
    timeout: 30000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    headers: {},
    followRedirects: true,
    maxRedirects: 5
  };

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.initializeCircuitBreakers();
  }

  private initializeCircuitBreakers(): void {
    // Initialize circuit breakers for each scraping method
    const methods = ['scraperapi', 'playwright', 'puppeteer', 'fetch', 'archive'];
    
    for (const method of methods) {
      this.circuitBreakers.set(
        method,
        createCircuitBreaker(method, this.supabase)
      );
    }
  }

  async scrape(url: string, options?: ScrapingOptions): Promise<ScrapingResult> {
    const opts = { ...this.defaultOptions, ...options };
    const errors: Array<{ method: string; error: Error }> = [];
    const startTime = Date.now();

    console.log(`Starting scraping fallback chain for: ${url}`);

    // Define scraping strategies in order of preference
    const strategies = [
      { name: 'scraperapi', method: this.scrapeWithScraperAPI.bind(this) },
      { name: 'playwright', method: this.scrapeWithPlaywright.bind(this) },
      { name: 'puppeteer', method: this.scrapeWithPuppeteer.bind(this) },
      { name: 'fetch', method: this.scrapeWithFetch.bind(this) },
      { name: 'archive', method: this.scrapeFromArchive.bind(this) }
    ];

    // Try each strategy
    for (const strategy of strategies) {
      const circuitBreaker = this.circuitBreakers.get(strategy.name);
      
      // Check if circuit breaker allows this attempt
      if (circuitBreaker && !(await circuitBreaker.isAvailable())) {
        console.log(`Skipping ${strategy.name} - circuit breaker is open or quota exceeded`);
        errors.push({
          method: strategy.name,
          error: new Error('Circuit breaker open or quota exceeded')
        });
        continue;
      }

      try {
        console.log(`Attempting to scrape with ${strategy.name}...`);
        
        const result = await retryExternalAPI(
          async () => {
            if (circuitBreaker) {
              return await circuitBreaker.execute(() => 
                strategy.method(url, opts)
              );
            }
            return await strategy.method(url, opts);
          },
          strategy.name,
          {
            maxRetries: 2,
            baseDelay: 1000,
            maxDelay: 10000
          }
        );

        // Validate result
        if (result.html && result.html.length > 100) {
          const responseTime = Date.now() - startTime;
          console.log(`Successfully scraped with ${strategy.name} in ${responseTime}ms`);
          
          return {
            ...result,
            method: strategy.name,
            metadata: {
              ...result.metadata,
              responseTime
            }
          };
        } else {
          throw new Error('Invalid or empty HTML response');
        }

      } catch (error) {
        const err = error as Error;
        console.error(`${strategy.name} failed: ${err.message}`);
        errors.push({ method: strategy.name, error: err });
        continue;
      }
    }

    // All strategies failed - return fallback content
    console.error(`All scraping strategies failed for ${url}`);
    return this.generateFallbackResult(url, errors);
  }

  private async scrapeWithScraperAPI(
    url: string, 
    options: Required<ScrapingOptions>
  ): Promise<ScrapingResult> {
    const apiKey = '6e6fccc00b94c6d57237a9afa3cc64b7';
    const scraperUrl = new URL('http://api.scraperapi.com');
    
    scraperUrl.searchParams.set('api_key', apiKey);
    scraperUrl.searchParams.set('url', url);
    scraperUrl.searchParams.set('premium', 'true');
    scraperUrl.searchParams.set('country_code', 'us');
    scraperUrl.searchParams.set('device_type', 'desktop');
    scraperUrl.searchParams.set('render', 'true');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(scraperUrl.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent,
          ...options.headers
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`ScraperAPI returned ${response.status}: ${response.statusText}`);
      }

      let html = await response.text();
      
      // Process HTML to fix encoding issues
      html = processHtmlContent(html);

      return {
        html,
        method: 'scraperapi',
        metadata: {
          statusCode: response.status,
          contentType: response.headers.get('content-type') || undefined,
          contentLength: parseInt(response.headers.get('content-length') || '0')
        }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async scrapeWithPlaywright(
    url: string,
    options: Required<ScrapingOptions>
  ): Promise<ScrapingResult> {
    // Placeholder for Playwright implementation
    // In production, this would use a Playwright service or edge function
    throw new Error('Playwright scraping not yet implemented');
  }

  private async scrapeWithPuppeteer(
    url: string,
    options: Required<ScrapingOptions>
  ): Promise<ScrapingResult> {
    // Placeholder for Puppeteer implementation
    // In production, this would use a Puppeteer service or edge function
    throw new Error('Puppeteer scraping not yet implemented');
  }

  private async scrapeWithFetch(
    url: string,
    options: Required<ScrapingOptions>
  ): Promise<ScrapingResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          ...options.headers
        },
        redirect: options.followRedirects ? 'follow' : 'manual'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Fetch returned ${response.status}: ${response.statusText}`);
      }

      let html = await response.text();
      
      // Process HTML to fix encoding issues
      html = processHtmlContent(html);

      return {
        html,
        method: 'fetch',
        metadata: {
          statusCode: response.status,
          contentType: response.headers.get('content-type') || undefined,
          contentLength: parseInt(response.headers.get('content-length') || '0')
        }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async scrapeFromArchive(
    url: string,
    options: Required<ScrapingOptions>
  ): Promise<ScrapingResult> {
    // Try Wayback Machine
    const archiveUrl = `https://web.archive.org/web/2/${url}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await fetch(archiveUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': options.userAgent,
          ...options.headers
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Archive fetch returned ${response.status}`);
      }

      let html = await response.text();
      
      // Clean up archive artifacts
      html = this.cleanArchiveHTML(html);
      
      // Process HTML to fix encoding issues
      html = processHtmlContent(html);

      return {
        html,
        method: 'archive',
        metadata: {
          statusCode: response.status,
          contentType: response.headers.get('content-type') || undefined,
          fromCache: true
        }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private cleanArchiveHTML(html: string): string {
    // Remove Wayback Machine toolbar and scripts
    html = html.replace(/<script[^>]*wayback[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<div[^>]*id="wm-ipp-base"[^>]*>[\s\S]*?<\/div>/gi, '');
    
    // Fix relative URLs to point to original domain
    html = html.replace(/\/web\/\d+\//g, '');
    
    return html;
  }

  private generateFallbackResult(
    url: string,
    errors: Array<{ method: string; error: Error }>
  ): ScrapingResult {
    const errorSummary = errors
      .map(e => `${e.method}: ${e.error.message}`)
      .join('\n');

    const fallbackHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Fallback Content - ${url}</title>
  <meta name="description" content="Unable to fetch content from ${url}">
  <meta name="generator" content="Synopsis Perfect Fallback">
</head>
<body>
  <h1>Content Unavailable</h1>
  <p>We were unable to fetch content from: <code>${url}</code></p>
  
  <h2>What We Know</h2>
  <ul>
    <li><strong>Domain:</strong> ${new URL(url).hostname}</li>
    <li><strong>Path:</strong> ${new URL(url).pathname}</li>
    <li><strong>Attempted at:</strong> ${new Date().toISOString()}</li>
  </ul>
  
  <h2>Errors Encountered</h2>
  <pre>${errorSummary}</pre>
  
  <h2>Suggestions</h2>
  <ul>
    <li>The website may be temporarily unavailable</li>
    <li>The page may have been moved or deleted</li>
    <li>There may be geographic or access restrictions</li>
  </ul>
  
  <!-- Metadata for processing -->
  <div style="display: none;" data-fallback="true" data-url="${url}">
    ${JSON.stringify({ errors: errors.map(e => ({ method: e.method, error: e.error.message })) })}
  </div>
</body>
</html>`;

    return {
      html: fallbackHTML,
      method: 'fallback',
      metadata: {
        statusCode: 0,
        contentLength: fallbackHTML.length,
        contentType: 'text/html',
        fromCache: false
      }
    };
  }

  // Check health of all scraping methods
  async getHealthStatus(): Promise<Record<string, any>> {
    const status: Record<string, any> = {};
    
    for (const [method, circuitBreaker] of this.circuitBreakers) {
      status[method] = await circuitBreaker.getStatus();
    }
    
    return status;
  }

  // Reset a specific circuit breaker
  async resetCircuitBreaker(method: string): Promise<void> {
    const circuitBreaker = this.circuitBreakers.get(method);
    if (circuitBreaker) {
      // Force a successful operation to reset the circuit
      try {
        await circuitBreaker.execute(async () => {
          return { success: true };
        });
      } catch (error) {
        console.error(`Failed to reset circuit breaker for ${method}:`, error);
      }
    }
  }
}

// Utility to extract text from HTML (fallback for markdown conversion)
export function extractTextFromHtml(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Replace common block elements with newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode HTML entities and clean text
  text = decodeHtmlEntities(text);
  text = cleanText(text);
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  
  return text.trim();
}