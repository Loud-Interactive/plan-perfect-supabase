// PagePerfect: ingest-gsc
// Function to fetch data from Google Search Console API and store in the database
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GSCFilterCriteria {
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
  minClicks?: number;
  maxKeywordsPerUrl?: number;
  keywordsSortBy?: string;  // 'impressions', 'clicks', 'position'
  specificUrls?: string[];  // Optional array of specific URLs to query
  additionalFilters?: Record<string, any>;
}

interface GSCRequestBody {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rowLimit?: number;
  startRow?: number;
  gscCredentials?: string;
  filters?: GSCFilterCriteria;
}

interface GSCQueryParams {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit: number;
  startRow?: number;
  dataState?: string;
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

    // Parse request body
    const { 
      siteUrl, 
      startDate, 
      endDate, 
      rowLimit = 50000, 
      startRow = 0, 
      gscCredentials,
      filters = {} 
    } = await req.json() as GSCRequestBody;
    
    // Log filters if specified
    if (filters && Object.keys(filters).length > 0) {
      console.log("Filtering criteria applied:", JSON.stringify(filters));
    }

    if (!siteUrl || !startDate || !endDate) {
      throw new Error('siteUrl, startDate, and endDate are required');
    }

    // Use credentials from request or environment variable
    let credentials;
    try {
      credentials = gscCredentials 
        ? (typeof gscCredentials === 'string' ? JSON.parse(gscCredentials) : gscCredentials)
        : JSON.parse(Deno.env.get('GSC_CREDENTIALS') || '{}');
      
      console.log("Parsed GSC credentials successfully");
    } catch (error) {
      console.error("Error parsing GSC credentials:", error);
      throw new Error(`Error parsing GSC credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // We now support multiple types of authentication, so don't require specific fields
    if (Object.keys(credentials).length === 0) {
      throw new Error('GSC credentials object is empty. Please provide valid credentials.');
    }

    console.log(`Fetching GSC data for ${siteUrl} from ${startDate} to ${endDate}`);

    // Get OAuth2 token for Google API
    const token = await getGoogleToken(credentials);
    
    // Test accessibility by fetching list of GSC sites accessible with this token
    try {
      console.log("Testing GSC API access by fetching sites list...");
      const testResponse = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (testResponse.ok) {
        const sitesList = await testResponse.json();
        console.log(`Successfully accessed GSC API. Found ${sitesList.siteEntry?.length || 0} sites.`);
        
        // Check if our target site is in the list
        const matchingSite = sitesList.siteEntry?.find((site: any) => 
          site.siteUrl === siteUrl || 
          site.siteUrl.toLowerCase() === siteUrl.toLowerCase()
        );
        
        if (matchingSite) {
          console.log(`Found target site in GSC sites list: ${matchingSite.siteUrl} with permission level: ${matchingSite.permissionLevel}`);
          
          // If site URLs differ in case or format, use the exact one from GSC
          if (matchingSite.siteUrl !== siteUrl) {
            console.log(`Updating site URL to match GSC exactly: ${matchingSite.siteUrl} (was: ${siteUrl})`);
            siteUrl = matchingSite.siteUrl;
          }
        } else {
          console.warn(`WARNING: Target site "${siteUrl}" not found in accessible GSC sites list. Available sites are:`);
          sitesList.siteEntry?.forEach((site: any) => {
            console.log(`  - ${site.siteUrl} (${site.permissionLevel})`);
          });
        }
      } else {
        const errorText = await testResponse.text();
        console.warn(`Could not fetch GSC sites list: ${testResponse.status} ${errorText}`);
      }
    } catch (error) {
      console.warn(`Error testing GSC API access: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    // Setup for pagination if needed
    const MAX_API_ROWS = 25000; // GSC API maximum rows per request
    let allRows: any[] = [];
    let currentStartRow = 0;
    let hasMoreData = true;
    let totalPages = 0;
    
    // Paginate through results if necessary
    while (hasMoreData) {
      totalPages++;
      console.log(`Fetching page ${totalPages} of GSC data starting at row ${currentStartRow}`);
      
      // Fetch GSC data with current pagination
      console.log(`Sending GSC API request with token: ${token.substring(0, 10)}...`);
      
      // Try first with standard dimensions
      console.log("Using standard dimensions: page, query");
      const dimensions = ['page', 'query'];
      
      const gscData = await fetchGSCData(token, siteUrl, {
        startDate,
        endDate,
        dimensions,
        rowLimit: Math.min(rowLimit, MAX_API_ROWS),
        startRow: currentStartRow,
        dataState: 'final'
      });
      
      // If no data, and this is the first attempt, try with simpler query
      if ((!gscData.rows || gscData.rows.length === 0) && totalPages === 1) {
        console.log("No data with standard dimensions. Trying a simpler query with just query dimension...");
        
        // Try a fallback request with just the 'query' dimension
        const fallbackData = await fetchGSCData(token, siteUrl, {
          startDate: startDate,
          endDate: endDate,
          dimensions: ['query'],
          rowLimit: 10, // Just check for any data
          startRow: 0,
          dataState: 'final'
        });
        
        if (fallbackData.rows && fallbackData.rows.length > 0) {
          console.log(`Found ${fallbackData.rows.length} rows with 'query' dimension only. Consider modifying your query.`);
        } else {
          console.log("No data found with 'query' dimension either.");
          
          // Try with a broader date range as a final test
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
          const broadStartDate = threeMonthsAgo.toISOString().split('T')[0];
          
          console.log(`Trying a broader date range: ${broadStartDate} to ${endDate}...`);
          
          const broadRangeData = await fetchGSCData(token, siteUrl, {
            startDate: broadStartDate,
            endDate: endDate,
            dimensions: ['query'],
            rowLimit: 10,
            startRow: 0,
            dataState: 'final'
          });
          
          if (broadRangeData.rows && broadRangeData.rows.length > 0) {
            console.log(`Found ${broadRangeData.rows.length} rows with broader date range. The site has data, but not for the specific date requested.`);
          } else {
            console.log("No data found with broader date range either. The site may not have any GSC data or there may be permission issues.");
          }
        }
      }
      
      // Log the entire response for debugging (with sensitive info redacted)
      console.log(`GSC API raw response: ${JSON.stringify(gscData, null, 2)}`);
      
      // Process the current page of results
      const currentPageRows = gscData.rows || [];
      const currentPageCount = currentPageRows.length;
      
      // Log detailed information about the results
      console.log(`GSC API returned ${currentPageCount} rows for request`);
      if (currentPageCount > 0) {
        console.log(`Sample row: ${JSON.stringify(currentPageRows[0])}`);
      } else {
        console.log(`No rows returned. ResponseRowCount: ${gscData.rowCount || 'undefined'}`);
      }
      
      console.log(`Fetched ${currentPageCount} rows in page ${totalPages}`);
      
      // Add to our collection
      allRows = allRows.concat(currentPageRows);
      
      // Check if we need to fetch more data
      hasMoreData = currentPageCount === MAX_API_ROWS && currentStartRow + MAX_API_ROWS < rowLimit;
      currentStartRow += MAX_API_ROWS;
      
      // Break if we've fetched enough rows based on the limit
      if (allRows.length >= rowLimit) {
        console.log(`Reached row limit of ${rowLimit}, stopping pagination`);
        break;
      }
      
      // If we're paginating, add a small delay to avoid rate limits
      if (hasMoreData) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Create a synthetic gscData object with all rows
    const gscDataComplete = { rows: allRows };
    const rowCount = allRows.length;
    
    console.log(`Fetched ${rowCount} total rows of GSC data across ${totalPages} page(s)`);
    
    if (rowCount === 0) {
      console.log("No data returned from GSC. This might be normal if:");
      console.log("1. There's no data for this date range");
      console.log("2. The site URL format doesn't match exactly how it appears in GSC");
      console.log("3. The service account doesn't have access to this property");
      console.log("4. The property doesn't exist in GSC");
      console.log("For domain properties, ensure format is 'sc-domain:example.com'");
      console.log("For URL-prefix properties, ensure exact match including protocol and trailing slash");
      console.log(`Current site URL: ${siteUrl}`);
    }
    
    // Transform data for database insertion with filtering
    const transformedData = transformGSCData(gscDataComplete, startDate, filters);
    
    // Log filtering results if filters were applied
    if (filters && Object.keys(filters).length > 0) {
      const originalCount = gscDataComplete.rows?.length || 0;
      const filteredCount = transformedData.length;
      const percentageRemoved = originalCount > 0 
        ? ((originalCount - filteredCount) / originalCount * 100).toFixed(2) 
        : "0";
      
      let filterSummary = `Filtering applied: ${originalCount} original rows → ${filteredCount} filtered rows (${percentageRemoved}% removed)`;
      
      // Add details about specific URL filtering if used
      if (filters.specificUrls && Array.isArray(filters.specificUrls) && filters.specificUrls.length > 0) {
        const urlCount = filters.specificUrls.length;
        filterSummary += `\nFiltered to ${urlCount} specific URLs`;
        
        // If small number of URLs, list them
        if (urlCount <= 5) {
          filterSummary += `: ${filters.specificUrls.join(", ")}`;
        }
      }
      
      console.log(filterSummary);
    }
    
    // Insert data using the bulk insert function
    console.log(`Transforming and inserting ${transformedData.length} rows of GSC data`);
    
    // First, ensure transformedData is in the correct format (array of objects)
    if (!Array.isArray(transformedData)) {
      throw new Error(`Invalid data format: transformedData is not an array`);
    }
    
    if (transformedData.length === 0) {
      console.log("No data to insert. Skipping database insertion.");
      return new Response(
        JSON.stringify({
          success: true,
          message: 'GSC data ingestion completed - no data to insert',
          rowsProcessed: 0,
          date: startDate,
          rowsFetched: rowCount,
          siteUrl: siteUrl,
          service_account: credentials.client_email || 'Unknown'
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    }
    
    try {
      // Log sample data for debugging
      console.log(`Sample data (first row): ${JSON.stringify(transformedData[0])}`);
      
      // Log the exact format we're sending to the database
      console.log(`Data type: ${typeof transformedData}, isArray: ${Array.isArray(transformedData)}, length: ${transformedData.length}`);
      
      // The SQL function expects a JSONB array, not a string
      // Pass the array directly without stringifying
      const rpcResult = await supabaseClient.rpc(
        'bulk_insert_gsc_page_query',
        { data: transformedData }
      );
  
      if (rpcResult.error) {
        console.error(`Database RPC error:`, rpcResult.error);
        throw new Error(`Database error: ${rpcResult.error.message}`);
      }
      
      // The SQL function returns the number of rows inserted
      const rowsInserted = rpcResult.data;
      console.log(`Successfully inserted ${rowsInserted} rows into database`);
      
      // For debugging, display the full RPC result
      console.log('RPC result:', JSON.stringify(rpcResult));
      
      // Capture available sites for response
      let availableSites: string[] = [];
      let hasSiteAccess = false;
      
      try {
        // Fetch list of sites again to include in response
        const sitesResponse = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
        
        if (sitesResponse.ok) {
          const sitesList = await sitesResponse.json();
          if (sitesList.siteEntry && Array.isArray(sitesList.siteEntry)) {
            availableSites = sitesList.siteEntry.map((site: any) => 
              `${site.siteUrl} (${site.permissionLevel})`
            );
            
            // Check if requested site is in the list
            hasSiteAccess = sitesList.siteEntry.some((site: any) => 
              site.siteUrl.toLowerCase() === siteUrl.toLowerCase()
            );
          }
        }
      } catch (error) {
        console.warn("Error fetching sites list for response:", error);
      }
      
      // Return success response with all available information
      return new Response(
        JSON.stringify({
          success: true,
          message: 'GSC data ingested successfully',
          rowsProcessed: rowsInserted,
          date: startDate,
          rowsFetched: rowCount,
          siteUrl: siteUrl,
          service_account: credentials.client_email || 'Unknown',
          sample_data: transformedData.slice(0, 2), // Include first 2 rows in response for debugging
          debug: {
            availableSites,
            hasSiteAccess,
            dateRange: `${startDate} to ${endDate}`
          }
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (dbError) {
      console.error(`Database operation failed:`, dbError);
      throw new Error(`Database operation failed: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }
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

// Simple in-memory cache for access tokens
// In a production environment, consider using KV store for persistence across instances
const tokenCache: Record<string, { token: string, expires: number }> = {};

// Token info return type
interface TokenInfo {
  token: string;
  type: string;
}

// Import the Google Auth helper
import { getGoogleAccessToken } from './googleauth.js';

// Function to get OAuth2 token for Google API
// Support both service account and direct token approaches
async function getGoogleToken(credentials: any): Promise<string> {
  console.log("Attempting to get Google API token");
  
  // Check cache first if we have a service account
  if (credentials.client_email) {
    const cacheKey = credentials.client_email;
    const cachedToken = tokenCache[cacheKey];
    const now = Math.floor(Date.now() / 1000);
    
    // If we have a cached token that's not expired (with 5 minute buffer)
    if (cachedToken && cachedToken.expires > now + 300) {
      console.log(`Using cached token for ${cacheKey}, expires in ${cachedToken.expires - now} seconds`);
      return cachedToken.token;
    }
    
    console.log(`No valid cached token found for ${cacheKey}, generating new one`);
  }
  
  // Declare tokenType for debugging
  let tokenType = 'unknown';
  
  // Priority 1: Use direct API token from environment variable (fastest for testing)
  const directApiToken = Deno.env.get('GSC_API_TOKEN');
  if (directApiToken) {
    console.log("Using GSC API token from environment variable");
    tokenType = 'direct_api_token';
    return directApiToken;
  }
  
  // Priority 2: Use token from credentials if provided
  if (credentials.api_token) {
    console.log("Using API token from credentials object");
    tokenType = 'credentials_api_token';
    return credentials.api_token;
  }
  
  // Priority 3: Use access_token if directly provided
  if (credentials.access_token) {
    console.log("Using access_token from credentials object");
    tokenType = 'credentials_access_token';
    return credentials.access_token;
  }

  // Priority 4: Check for OAuth Playground token in specific environment variable
  const oauthPlaygroundToken = Deno.env.get('GSC_OAUTH_PLAYGROUND_TOKEN');
  if (oauthPlaygroundToken) {
    console.log("Using token from GSC_OAUTH_PLAYGROUND_TOKEN environment variable");
    tokenType = 'oauth_playground_token';
    return oauthPlaygroundToken;
  }
  
  // Priority 5: Generate JWT token from service account credentials
  // This is the recommended approach for production environments
  if (credentials.private_key && credentials.client_email) {
    console.log("Generating JWT from service account credentials");
    tokenType = 'service_account_jwt';
    
    try {
      // Use our improved googleauth helper for reliable JWT generation
      const token = await getGoogleAccessToken(credentials);
      
      // Calculate expiration (token usually lasts 1 hour)
      const expires = Math.floor(Date.now() / 1000) + 3300; // 55 minutes
      
      // Cache the token
      const cacheKey = credentials.client_email;
      tokenCache[cacheKey] = {
        token,
        expires
      };
      
      console.log(`Cached new token for ${cacheKey}, expires in 3300 seconds`);
      return token;
    } catch (error) {
      console.error("Error generating access token:", error);
      throw new Error(`Failed to generate access token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // If we get here, we couldn't get a token
  console.warn("No valid credentials found for GSC API access.");
  console.warn("For service accounts, provide credentials with private_key and client_email.");
  console.warn("For direct token access, set GSC_API_TOKEN environment variable.");
  
  throw new Error("No valid GSC API token found. Please provide valid credentials or a direct token.");
}

// Implements exponential backoff retry logic
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let retries = 0;
  let lastError: Error | null = null;
  
  while (retries <= maxRetries) {
    try {
      const response = await fetch(url, options);
      
      // For HTTP 429 (Too Many Requests) or 5xx errors, retry with backoff
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        // Calculate delay with exponential backoff plus jitter
        const delay = Math.min(1000 * Math.pow(2, retries) + Math.random() * 1000, 10000);
        console.log(`Rate limited (${response.status}). Retrying in ${delay}ms (attempt ${retries + 1} of ${maxRetries + 1})`);
        
        // Return the retry-after header value if it exists
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          console.log(`Server requested retry after ${retryAfter} seconds`);
        }
        
        // Wait for the delay
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
        continue;
      }
      
      // For all other responses (success or other errors), return without retry
      return response;
    } catch (error) {
      console.error(`Network error on attempt ${retries + 1}:`, error);
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // If it's the last retry, throw the error
      if (retries === maxRetries) {
        throw lastError;
      }
      
      // Otherwise, wait and retry
      const delay = Math.min(1000 * Math.pow(2, retries) + Math.random() * 1000, 10000);
      console.log(`Retrying in ${delay}ms (attempt ${retries + 1} of ${maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      retries++;
    }
  }
  
  // We should never reach here, but just in case
  throw lastError || new Error('Unknown error in fetchWithRetry');
}

// Function to fetch data from GSC API
async function fetchGSCData(token: string, siteUrl: string, params: GSCQueryParams): Promise<any> {
  // Make sure the site URL is properly formatted
  // For domain properties, it should look like: sc-domain:example.com
  // For URL-prefix properties, it should match the format in GSC exactly (including trailing slash if present)
  console.log(`Processing site URL for GSC API: ${siteUrl}`);
  
  const encodedSiteUrl = encodeURIComponent(siteUrl);
  const url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' + 
              encodedSiteUrl + '/searchAnalytics/query';
  
  console.log(`Requesting GSC data from: ${url}`);
  
  try {
    // Use fetchWithRetry for resilience
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions,
        rowLimit: params.rowLimit,
        startRow: params.startRow || 0,
        dataState: params.dataState || 'final',
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GSC API error response: ${errorText}`);
      
      try {
        const errorData = JSON.parse(errorText);
        const errorMessage = errorData.error?.message || JSON.stringify(errorData);
        
        let errorDetails = '';
        if (errorData.error?.status === 'PERMISSION_DENIED') {
          errorDetails = ' - Verify you have proper access to this GSC property';
        } else if (errorData.error?.status === 'INVALID_ARGUMENT') {
          errorDetails = ' - Check if your site URL format is correct';
        } else if (response.status === 403) {
          errorDetails = ' - This may be due to insufficient permissions or quotas. Verify the service account has access to this GSC property.';
        } else if (response.status === 401) {
          errorDetails = ' - Authentication failed. The token may be expired or invalid.';
        }
        
        throw new Error(`GSC API error: ${errorMessage}${errorDetails}`);
      } catch (parseError) {
        // If we couldn't parse the error response as JSON
        throw new Error(`GSC API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
    }
    
    return response.json();
  } catch (error) {
    console.error('Error in fetchGSCData:', error);
    throw error;
  }
}

// Function to transform GSC data for database insertion
function transformGSCData(gscData: any, fetchDate: string, filters: GSCFilterCriteria = {}): any[] {
  if (!gscData.rows) {
    return [];
  }
  
  // Extract filtering criteria
  const { 
    minPosition, 
    maxPosition, 
    minImpressions, 
    minClicks,
    maxKeywordsPerUrl,
    keywordsSortBy = 'impressions',
    specificUrls
  } = filters;
  
  // Map rows to our format
  let processedRows = gscData.rows.map((row: any) => {
    // Extracting page and query from dimensions
    const pageUrl = row.keys[0];
    const keyword = row.keys[1];
    
    return {
      fetched_date: fetchDate,
      page_url: pageUrl,
      keyword: keyword,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0
    };
  });
  
  // Apply basic filters first
  processedRows = processedRows.filter((item: any) => {
    // Filter by specific URLs if provided
    if (specificUrls && Array.isArray(specificUrls) && specificUrls.length > 0) {
      // Check if the current URL is in the list of specific URLs
      if (!specificUrls.some(url => item.page_url === url || item.page_url.endsWith(url))) {
        return false;
      }
    }
    
    // Apply position filters if specified
    if (minPosition !== undefined && item.position < minPosition) {
      return false;
    }
    if (maxPosition !== undefined && item.position > maxPosition) {
      return false;
    }
    
    // Apply impression filters if specified
    if (minImpressions !== undefined && item.impressions < minImpressions) {
      return false;
    }
    
    // Apply click filters if specified
    if (minClicks !== undefined && item.clicks < minClicks) {
      return false;
    }
    
    return true;
  });
  
  // Apply maximum keywords per URL filter if specified
  if (maxKeywordsPerUrl !== undefined && maxKeywordsPerUrl > 0) {
    console.log(`Applying max keywords per URL filter: ${maxKeywordsPerUrl} (sorted by ${keywordsSortBy})`);
    
    // Group by URL
    const urlGroups: Record<string, any[]> = {};
    
    processedRows.forEach((row: any) => {
      if (!urlGroups[row.page_url]) {
        urlGroups[row.page_url] = [];
      }
      urlGroups[row.page_url].push(row);
    });
    
    // Sort and limit each group
    let limitedRows: any[] = [];
    
    Object.keys(urlGroups).forEach(url => {
      const group = urlGroups[url];
      
      // Sort based on the selected criterion (default: impressions)
      // For position, we want ascending (lower is better)
      // For impressions and clicks, we want descending (higher is better)
      const sortedGroup = [...group].sort((a, b) => {
        if (keywordsSortBy === 'position') {
          return a.position - b.position; // Ascending
        } else if (keywordsSortBy === 'clicks') {
          return b.clicks - a.clicks; // Descending
        } else {
          // Default to impressions
          return b.impressions - a.impressions; // Descending
        }
      });
      
      // Take only the top N keywords
      const limitedGroup = sortedGroup.slice(0, maxKeywordsPerUrl);
      limitedRows = limitedRows.concat(limitedGroup);
    });
    
    // Log the limiting results
    console.log(`Limited keywords: ${processedRows.length} → ${limitedRows.length} (${Object.keys(urlGroups).length} URLs)`);
    
    return limitedRows;
  }
  
  return processedRows;
}