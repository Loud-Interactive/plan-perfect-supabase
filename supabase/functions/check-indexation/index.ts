// Check Indexation Status API for Google Search Console
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getGSCAccessToken, checkSiteUrl, extractDomain, corsHeaders } from '../utils-gsc/index.ts';

interface RequestBody {
  url: string;
  siteUrl?: string;
}

/**
 * Enum representing indexing status of a URL
 */
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

/**
 * Maps status names to emoji representations
 */
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

/**
 * Checks the indexing status of a URL using the URL Inspection API.
 * @param accessToken Access token for GSC API
 * @param siteUrl Site URL in GSC
 * @param inspectionUrl URL to check
 * @returns Inspection result from the API
 */
async function checkIndexingStatus(accessToken: string, siteUrl: string, inspectionUrl: string): Promise<any> {
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
    const data = await req.json() as RequestBody;
    
    if (!data.url) {
      throw new Error('URL is required');
    }

    // Get GSC access token
    const accessToken = await getGSCAccessToken();

    // Determine site URL
    let siteUrl = '';
    if (data.siteUrl) {
      // Verify site URL format and access
      siteUrl = await checkSiteUrl(accessToken, data.siteUrl);
    } else {
      // Extract domain from URL and check access
      const domain = extractDomain(data.url);
      siteUrl = await checkSiteUrl(accessToken, domain);
    }

    // Check indexation status
    const status = await checkIndexingStatus(accessToken, siteUrl, data.url);
    
    // Extract coverage state if available
    const coverageState = status && status.indexStatusResult && status.indexStatusResult.coverageState 
      ? status.indexStatusResult.coverageState
      : IndexingStatus.URLIsUnknownToGoogle;
    
    // Get emoji for status
    const emoji = StatusEmoji[coverageState] || StatusEmoji[IndexingStatus.Error];

    // Log the check in the database (optional)
    try {
      await supabaseClient
        .from('indexation_checks')
        .insert({
          url: data.url,
          site_url: siteUrl,
          status: coverageState,
          details: status
        });
    } catch (dbError) {
      console.error(`Error logging check to database: ${dbError.message}`);
      // Continue even if database logging fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: data.url,
        siteUrl,
        coverageState,
        emoji,
        status
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});