// PagePerfect: pageperfect-batch-processor
// Batch processor for running PagePerfect workflow on multiple URLs
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  urls: string[];
  batchSize?: number;
  clientId?: string;
  projectId?: string;
  
  // ScraperAPI settings
  premium?: boolean;
  ultraPremium?: boolean;
  render?: boolean;
  timeout?: number;
  
  // PagePerfect workflow settings
  skipSteps?: string[];
  forceUpdate?: boolean;
  openaiApiKey?: string;
  
  // Batch processing control
  enableFullWorkflow?: boolean;
}

interface BatchRecord {
  id: string;
  clientId?: string;
  projectId?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  totalUrls: number;
  processedUrls: number;
  successfulUrls: number;
  failedUrls: number;
  config: {
    premium: boolean;
    ultraPremium: boolean;
    render: boolean;
    timeout: number;
    enableFullWorkflow: boolean;
    skipSteps: string[];
  };
  createdAt: string;
  updatedAt: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Parse request
    const { 
      urls, 
      batchSize = 10, 
      clientId, 
      projectId,
      premium = false,
      ultraPremium = false,
      render = true,
      timeout = 60000,
      skipSteps = [],
      forceUpdate = false,
      openaiApiKey,
      enableFullWorkflow = false
    } = await req.json() as RequestBody;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      throw new Error('A valid array of URLs is required');
    }
    
    // Use API key from request or environment variable
    const apiKey = openaiApiKey || Deno.env.get('OPENAI_API_KEY');
    
    // Generate a batch ID and timestamp
    const batchId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    // Create a batch record
    const batch: BatchRecord = {
      id: batchId,
      clientId,
      projectId,
      status: 'pending',
      totalUrls: urls.length,
      processedUrls: 0,
      successfulUrls: 0,
      failedUrls: 0,
      config: {
        premium,
        ultraPremium,
        render,
        timeout,
        enableFullWorkflow,
        skipSteps
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    
    // Insert batch record
    const { error: batchError } = await supabaseClient
      .from('page_perfect_batches')
      .insert({
        id: batchId,
        client_id: clientId,
        project_id: projectId,
        status: 'pending',
        total_urls: urls.length,
        processed_urls: 0,
        successful_urls: 0,
        failed_urls: 0,
        config: batch.config,
        created_at: timestamp,
        updated_at: timestamp
      });
      
    if (batchError) {
      throw new Error(`Failed to create batch: ${batchError.message}`);
    }
    
    // Create URL status records
    const urlStatusRecords = urls.map(url => ({
      batch_id: batchId,
      url,
      status: 'pending',
      created_at: timestamp,
      updated_at: timestamp
    }));
    
    const { error: urlStatusError } = await supabaseClient
      .from('page_perfect_url_status')
      .insert(urlStatusRecords);
      
    if (urlStatusError) {
      throw new Error(`Failed to create URL status records: ${urlStatusError.message}`);
    }
    
    // Start batch processing in the background
    processBatch(batchId, batchSize, enableFullWorkflow, supabaseClient)
      .catch(error => console.error(`Error processing batch ${batchId}: ${error.message}`));
    
    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        batchId,
        message: `Successfully created batch with ${urls.length} URLs. Processing has started.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});

// Process a batch of URLs
async function processBatch(
  batchId: string, 
  batchSize: number, 
  enableFullWorkflow: boolean,
  supabaseClient: any
) {
  try {
    // Update batch status to processing
    await supabaseClient
      .from('page_perfect_batches')
      .update({ 
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', batchId);
    
    // Get batch configuration
    const { data: batchData, error: batchError } = await supabaseClient
      .from('page_perfect_batches')
      .select('*')
      .eq('id', batchId)
      .single();
      
    if (batchError || !batchData) {
      throw new Error(`Failed to get batch data: ${batchError?.message || 'Batch not found'}`);
    }
    
    // Process URLs in batches
    let continueProcessing = true;
    
    while (continueProcessing) {
      // Get pending URLs for this batch
      const { data: pendingUrls, error: pendingError } = await supabaseClient
        .from('page_perfect_url_status')
        .select('id, url')
        .eq('batch_id', batchId)
        .eq('status', 'pending')
        .limit(batchSize);
        
      if (pendingError) {
        throw new Error(`Failed to get pending URLs: ${pendingError.message}`);
      }
      
      if (!pendingUrls || pendingUrls.length === 0) {
        continueProcessing = false;
        break;
      }
      
      // Process each URL in the batch
      const results = await Promise.allSettled(
        pendingUrls.map(async (urlRecord) => {
          try {
            // Mark URL as processing
            await supabaseClient
              .from('page_perfect_url_status')
              .update({
                status: 'processing',
                updated_at: new Date().toISOString()
              })
              .eq('id', urlRecord.id);
            
            let result;
            
            if (enableFullWorkflow) {
              // Use PagePerfect workflow for full analysis
              result = await runPagePerfectWorkflow(
                urlRecord.url,
                batchData.config,
                supabaseClient
              );
            } else {
              // Use just ScraperAPI for basic HTML fetching
              result = await fetchHtmlWithScraperApi(
                urlRecord.url,
                batchData.config
              );
            }
            
            // Mark URL as completed
            await supabaseClient
              .from('page_perfect_url_status')
              .update({
                status: 'completed',
                html: result.html,
                html_length: result.html?.length || 0,
                analysis: result.analysis || null,
                page_id: result.pageId || null,
                updated_at: new Date().toISOString()
              })
              .eq('id', urlRecord.id);
              
            return { success: true, urlId: urlRecord.id };
          } catch (error) {
            // Mark URL as error
            await supabaseClient
              .from('page_perfect_url_status')
              .update({
                status: 'error',
                errormessage: error instanceof Error ? error.message : 'Unknown error',
                updated_at: new Date().toISOString()
              })
              .eq('id', urlRecord.id);
              
            return { success: false, urlId: urlRecord.id, error };
          }
        })
      );
      
      // Count successes and failures
      const successes = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
      
      // Update batch statistics
      const { data: statusCounts, error: countError } = await supabaseClient
        .from('page_perfect_url_status')
        .select('status, count(*)')
        .eq('batch_id', batchId)
        .in('status', ['completed', 'error'])
        .group('status');
        
      if (countError) {
        console.error(`Error getting status counts: ${countError.message}`);
        continue;
      }
      
      // Calculate totals
      let completedCount = 0;
      let errorCount = 0;
      
      for (const item of statusCounts) {
        if (item.status === 'completed') {
          completedCount = parseInt(item.count);
        } else if (item.status === 'error') {
          errorCount = parseInt(item.count);
        }
      }
      
      const processedCount = completedCount + errorCount;
      
      // Update batch record
      await supabaseClient
        .from('page_perfect_batches')
        .update({
          processed_urls: processedCount,
          successful_urls: completedCount,
          failed_urls: errorCount,
          status: processedCount >= batchData.total_urls ? 'completed' : 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', batchId);
        
      // If we've processed all URLs, we're done
      if (processedCount >= batchData.total_urls) {
        continueProcessing = false;
      }
      
      // Small delay to prevent too rapid processing
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final update to batch status
    const { data: finalCounts, error: finalCountError } = await supabaseClient
      .from('page_perfect_url_status')
      .select('status, count(*)')
      .eq('batch_id', batchId)
      .group('status');
      
    if (!finalCountError) {
      let completedCount = 0;
      let errorCount = 0;
      
      for (const item of finalCounts) {
        if (item.status === 'completed') {
          completedCount = parseInt(item.count);
        } else if (item.status === 'error') {
          errorCount = parseInt(item.count);
        }
      }
      
      const processedCount = completedCount + errorCount;
      
      await supabaseClient
        .from('page_perfect_batches')
        .update({
          processed_urls: processedCount,
          successful_urls: completedCount,
          failed_urls: errorCount,
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', batchId);
    }
    
    console.log(`Batch ${batchId} processing completed`);
  } catch (error) {
    console.error(`Error processing batch ${batchId}: ${error.message}`);
    
    // Update batch status to error
    await supabaseClient
      .from('page_perfect_batches')
      .update({
        status: 'error',
        updated_at: new Date().toISOString()
      })
      .eq('id', batchId);
  }
}

// Fetch HTML using ScraperAPI
async function fetchHtmlWithScraperApi(url: string, config: any) {
  const scraperApiKey = Deno.env.get('SCRAPER_API_KEY') || '';
  if (!scraperApiKey) {
    throw new Error('SCRAPER_API_KEY environment variable is not set');
  }
  
  // Determine if URL is from a protected site and needs special handling
  const isProtectedSite = isProtectedDomain(url);
  
  // Configure ScraperAPI parameters
  const params = new URLSearchParams({
    'api_key': scraperApiKey,
    'url': url,
    'country_code': 'us',
  });
  
  // Apply configuration settings
  if (config.premium || isProtectedSite) {
    params.set('premium', 'true');
  }
  
  if (config.ultraPremium || (isProtectedSite && url.includes('orientaltrading.com'))) {
    params.set('ultra_premium', 'true');
  }
  
  if (config.render !== false) {
    params.set('render', 'true');
  }
  
  // Configure timeout
  params.set('timeout', config.timeout ? config.timeout.toString() : '60000');
  
  // Construct the ScraperAPI URL
  const scraperUrl = `http://api.scraperapi.com/?${params.toString()}`;
  
  // Fetch using ScraperAPI
  const response = await fetch(scraperUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml'
    },
    redirect: 'follow',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch URL via ScraperAPI: ${response.status} ${response.statusText}`);
  }
  
  const html = await response.text();
  
  // Validate HTML content
  if (!html || html.length < 100) {
    throw new Error('Invalid or empty HTML content received');
  }
  
  // Extract title and description using regex
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i) || 
                          html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
  
  const title = titleMatch ? titleMatch[1].trim() : null;
  const description = descriptionMatch ? descriptionMatch[1].trim() : null;
  
  // Use Claude to analyze the content
  let analysis = null;
  try {
    analysis = await analyzeHtmlWithClaude(html, url);
  } catch (error) {
    console.error(`Error analyzing HTML with Claude: ${error.message}`);
  }
  
  return {
    html,
    title,
    description,
    html_length: html.length,
    analysis
  };
}

// Run the complete PagePerfect workflow
async function runPagePerfectWorkflow(url: string, config: any, supabaseClient: any) {
  // First, run the PagePerfect workflow Edge Function
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/pageperfect-workflow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
    },
    body: JSON.stringify({
      url,
      skipSteps: config.skipSteps || [],
      forceUpdate: config.forceUpdate || false,
      openaiApiKey: Deno.env.get('OPENAI_API_KEY'),
      premium: config.premium,
      ultraPremium: config.ultraPremium,
      render: config.render,
      timeout: config.timeout
    })
  });
  
  if (!response.ok) {
    let errorMessage = `PagePerfect workflow failed with status ${response.status}`;
    try {
      const errorJson = await response.json();
      errorMessage = errorJson.error || errorMessage;
    } catch (e) {
      // Ignore JSON parsing errors
    }
    throw new Error(errorMessage);
  }
  
  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || 'PagePerfect workflow failed');
  }
  
  // Get the page data for HTML content
  const { data: pageData, error: pageError } = await supabaseClient
    .from('pages')
    .select('html')
    .eq('id', result.pageId)
    .single();
    
  if (pageError) {
    throw new Error(`Failed to fetch page HTML: ${pageError.message}`);
  }
  
  return {
    html: pageData.html,
    pageId: result.pageId,
    analysis: result.results,
    html_length: pageData.html?.length || 0
  };
}

// Analyze HTML content using Claude
async function analyzeHtmlWithClaude(html: string, url: string) {
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  
  // Truncate HTML if it's too large
  const maxLength = 100000; // 100K characters is reasonable for Claude 
  const truncatedHtml = html.length > maxLength 
    ? html.substring(0, maxLength) + '... [HTML TRUNCATED]' 
    : html;
  
  // Extract main content area using basic regex for better analysis
  const bodyMatch = truncatedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : truncatedHtml;
  
  // Remove scripts and styles for cleaner analysis
  const cleanedContent = bodyContent
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
  
  // Claude 3.5 Sonnet prompt for analysis
  const prompt = `Analyze this HTML content from the URL ${url} and extract the following information:

1. Main page title (h1)
2. All headings (h1, h2, h3) in hierarchical structure
3. Meta title and description
4. All paragraph content
5. Identify main sections
6. Extract all links
7. Product information (if this is a product page)
8. Tables and lists
9. Image descriptions and alt text

Provide a comprehensive analysis that explains what this page is about, its structure, and key content. Analyze the SEO elements and content quality. If this is a product page, analyze the sales copy and product information.

HTML CONTENT:
${cleanedContent}`;

  const data = {
    model: "claude-3-5-sonnet-20240620",
    messages: [{
      role: "user",
      content: prompt
    }],
    max_tokens: 4000,
    temperature: 0,
  };

  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!anthropicResponse.ok) {
    const errorText = await anthropicResponse.text();
    throw new Error(`Claude API error: ${anthropicResponse.status} - ${errorText}`);
  }

  const anthropicData = await anthropicResponse.json();
  const analysis = anthropicData.content[0].text;

  return {
    content: analysis,
    timestamp: new Date().toISOString()
  };
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