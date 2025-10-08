// update-seo-indexation-status
// Updates indexation status in page_seo_recommendations from Google Search Console
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getGSCAccessToken, checkSiteUrl, extractDomain, corsHeaders } from '../utils-gsc/index.ts';
import { logError, retryWithBackoff } from '../utils/error-handling.ts';

// Indexation status enum from check-indexation function
enum IndexingStatus {
  SubmittedAndIndexed = "Submitted and indexed",
  DuplicateWithoutUserSelectedCanonical = "Duplicate without user-selected canonical",
  CrawledCurrentlyNotIndexed = "Crawled - currently not indexed",
  DiscoveredCurrentlyNotIndexed = "Discovered - currently not indexed",
  PageWithRedirect = "Page with redirect",
  URLIsUnknownToGoogle = "URL is unknown to Google",
  RateLimited = "RateLimited",
  Forbidden = "Forbidden",
  Error = "Error"
}

// Status emoji map
const StatusEmoji: Record<string, string> = {
  [IndexingStatus.SubmittedAndIndexed]: "✅",
  [IndexingStatus.DuplicateWithoutUserSelectedCanonical]: "😵",
  [IndexingStatus.CrawledCurrentlyNotIndexed]: "👀",
  [IndexingStatus.DiscoveredCurrentlyNotIndexed]: "👀",
  [IndexingStatus.PageWithRedirect]: "🔀",
  [IndexingStatus.URLIsUnknownToGoogle]: "❓",
  [IndexingStatus.RateLimited]: "🚦",
  [IndexingStatus.Forbidden]: "🔐",
  [IndexingStatus.Error]: "❌"
};

// Batch size for processing
const BATCH_SIZE = 50;
// Request delay in ms to avoid rate limiting
const REQUEST_DELAY = 250;

interface RequestBody {
  batchSize?: number;
  checkInLastDays?: number;
  force?: boolean;
  specificUrls?: string[];
  missingDataOnly?: boolean;
  prioritizeMissingData?: boolean;
  checkForMissing?: boolean;
}

/**
 * Checks indexing status via URL Inspection API
 */
async function checkIndexingStatus(accessToken: string, siteUrl: string, inspectionUrl: string): Promise<any> {
  return await retryWithBackoff(async () => {
    const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        inspectionUrl,
        siteUrl,
      }),
    });

    if (!response.ok) {
      console.error(`Error checking indexing status: ${response.status}`);
      if (response.status === 403) {
        throw new Error('Service account does not have access to this site');
      } else if (response.status === 429) {
        throw new Error('Rate limit exceeded, try again later');
      }
      throw new Error(`Failed to check indexing status: ${response.statusText}`);
    }

    const body = await response.json();
    return body.inspectionResult;
  }, 3, 2000);
}

/**
 * Updates page_seo_recommendations with indexation status
 */
async function updateIndexationStatus(
  supabase: any, 
  accessToken: string, 
  urlId: string, 
  urlString: string, 
  siteUrl: string
): Promise<boolean> {
  try {
    console.log(`Checking indexation for ${urlString}`);
    
    // Perform URL inspection
    const status = await checkIndexingStatus(accessToken, siteUrl, urlString);
    
    // Extract coverage state
    const coverageState = status && status.indexStatusResult && status.indexStatusResult.coverageState 
      ? status.indexStatusResult.coverageState
      : IndexingStatus.URLIsUnknownToGoogle;
    
    // Get emoji for status
    const emoji = StatusEmoji[coverageState] || StatusEmoji[IndexingStatus.Error];
    
    // Extract mobile usability & rich results status if available
    const mobileUsabilityStatus = status?.mobileUsabilityResult?.verdict || null;
    const richResultsStatus = status?.richResultsResult?.verdict || null;
    
    console.log(`Indexation status for ${urlString}: ${coverageState} ${emoji}`);
    
    // Update database
    const { error } = await supabase
      .from('page_seo_recommendations')
      .update({
        indexation_status: coverageState,
        indexation_emoji: emoji,
        indexation_last_checked: new Date().toISOString(),
        indexation_details: status,
        mobile_usability_status: mobileUsabilityStatus,
        rich_results_status: richResultsStatus
      })
      .eq('id', urlId);
      
    if (error) {
      console.error(`Error updating database for ${urlString}: ${error.message}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error processing ${urlString}: ${error.message}`);
    await logError('update-seo-indexation-status', urlString, error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse request body
    let data: RequestBody = {};
    try {
      data = await req.json();
    } catch (e) {
      // Default empty object if no JSON provided
      data = {};
    }
    
    // Get request parameters with defaults
    const batchSize = data.batchSize || BATCH_SIZE;
    const checkInLastDays = data.checkInLastDays || 30;
    const force = data.force || false;
    const specificUrls = data.specificUrls || [];
    
    // Get GSC access token
    const accessToken = await getGSCAccessToken();
    
    // Define query to get URLs that need indexation status updated
    let query = supabaseClient
      .from('page_seo_recommendations')
      .select('id, url')
      .order('indexation_last_checked', { ascending: true, nullsFirst: true });
    
    // Handle specific URLs if provided
    if (specificUrls.length > 0) {
      query = query.in('url', specificUrls);
    } else if (data.missingDataOnly) {
      // Get only pages with no indexation data
      query = query.is('indexation_status', null);
    } else if (data.prioritizeMissingData) {
      // First get pages with missing data, then older ones
      query = query.or('indexation_status.is.null,indexation_emoji.is.null');
    } else if (data.checkForMissing) {
      // Check both missing data and outdated data
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - checkInLastDays);
      
      query = query.or(`indexation_status.is.null,indexation_last_checked.lt.${cutoffDate.toISOString()}`);
    } else if (!force) {
      // If not forcing all updates, only select records that haven't been checked recently
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - checkInLastDays);
      
      query = query.or(`indexation_last_checked.is.null,indexation_last_checked.lt.${cutoffDate.toISOString()}`);
    }
    
    // Limit to batch size
    query = query.limit(batchSize);
    
    // Execute query to get URLs to process
    const { data: pagesToCheck, error: queryError } = await query;
    
    if (queryError) {
      throw new Error(`Error querying database: ${queryError.message}`);
    }
    
    if (!pagesToCheck || pagesToCheck.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pages need indexation status updates at this time",
          processed: 0
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log(`Processing ${pagesToCheck.length} pages for indexation status updates`);
    
    // Track results
    const results = {
      total: pagesToCheck.length,
      successful: 0,
      failed: 0,
      urls: {} as Record<string, string>
    };
    
    // Process each URL
    for (const page of pagesToCheck) {
      try {
        if (!page.url) {
          console.warn(`Skipping page ${page.id} with no URL`);
          results.failed++;
          results.urls[page.id] = 'Missing URL';
          continue;
        }
        
        // Extract domain from URL
        const domain = extractDomain(page.url);
        
        // Get GSC site URL format
        const siteUrl = await checkSiteUrl(accessToken, domain);
        
        // Update indexation status
        const success = await updateIndexationStatus(
          supabaseClient,
          accessToken,
          page.id,
          page.url,
          siteUrl
        );
        
        if (success) {
          results.successful++;
          results.urls[page.id] = 'Success';
        } else {
          results.failed++;
          results.urls[page.id] = 'Failed';
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      } catch (error) {
        console.error(`Error processing page ${page.id}: ${error.message}`);
        results.failed++;
        results.urls[page.id] = error.message;
      }
    }
    
    // Return results
    return new Response(
      JSON.stringify({
        success: true,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    await logError('update-seo-indexation-status', null, error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});