// batch-fetch-gsc
// Edge function to fetch GSC data for batches of URLs and optionally save to database

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getGoogleAccessToken } from '../ingest-gsc/googleauth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const {
      siteUrl,           // GSC property URL (e.g., sc-domain:example.com)
      startDate,         // Start date (YYYY-MM-DD)
      endDate,           // End date (YYYY-MM-DD)
      urls,              // Array of URLs to fetch data for
      dimensions,        // Array of dimensions (e.g., ["page", "query"])
      filters,           // Optional filters (maxPosition, minImpressions, etc.)
      saveToDatabase = false, // Whether to save data to database tables
      clientId           // Required if saveToDatabase is true
    } = await req.json();
    
    // Validate required parameters
    if (!siteUrl || !startDate || !endDate || !urls || !urls.length) {
      throw new Error('Missing required parameters: siteUrl, startDate, endDate, and urls array are required');
    }
    
    if (!dimensions || !dimensions.length) {
      throw new Error('At least one dimension must be specified');
    }
    
    // Check if clientId is provided when saving to database
    if (saveToDatabase && !clientId) {
      throw new Error('clientId is required when saveToDatabase is true');
    }
    
    console.log(`Fetching GSC data for ${urls.length} URLs from ${startDate} to ${endDate}`);
    console.log(`Using dimensions: ${dimensions.join(', ')}`);
    if (saveToDatabase) {
      console.log(`Will save data to database for client: ${clientId}`);
    }
    
    // Create Supabase client if we need to save to database
    let supabaseClient;
    if (saveToDatabase) {
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
    }
    
    // Get GSC credentials from environment
    const credentials = JSON.parse(Deno.env.get('GSC_CREDENTIALS') || '{}');
    if (Object.keys(credentials).length === 0) {
      throw new Error('GSC_CREDENTIALS environment variable is missing or invalid');
    }
    
    // Get Google OAuth token
    console.log("Getting Google API access token...");
    const token = await getGoogleAccessToken(credentials);
    console.log(`Successfully obtained access token`);
    
    // Process each URL in the batch
    const results = [];
    let totalRowsSaved = 0;
    
    for (const url of urls) {
      try {
        console.log(`Processing URL: ${url}`);
        
        // Fetch GSC data for this URL
        const data = await fetchGscDataForUrl(token, siteUrl, url, startDate, endDate, dimensions, filters);
        
        console.log(`Success for ${url}: Found ${data.metrics.keywordCount} keywords`);
        
        // Save to database if requested
        let savedToDb = false;
        let rowsSaved = 0;
        
        if (saveToDatabase && supabaseClient && data.rows.length > 0) {
          const transformedData = transformGSCDataForDB(data.rows, startDate, clientId, siteUrl);
          
          if (transformedData.length > 0) {
            try {
              // Use bulk insert RPC function
              const { data: rpcResult, error: rpcError } = await supabaseClient.rpc(
                'bulk_insert_gsc_page_query',
                { data: transformedData }
              );
              
              if (rpcError) {
                console.error(`Database insert error:`, rpcError);
                throw new Error(`Database error: ${rpcError.message}`);
              }
              
              // rpcResult should be the number of rows inserted
              rowsSaved = rpcResult || 0;
              totalRowsSaved += rowsSaved;
              savedToDb = true;
              
              console.log(`Saved ${rowsSaved} rows to database for ${url}`);
            } catch (dbError) {
              console.error(`Failed to save to database: ${dbError.message}`);
              savedToDb = false;
            }
          }
        }
        
        results.push({
          url,
          success: true,
          data,
          savedToDb,
          rowsSaved
        });
      } catch (error) {
        console.error(`Error processing ${url}: ${error instanceof Error ? error.message : String(error)}`);
        
        results.push({
          url,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          savedToDb: false,
          rowsSaved: 0
        });
      }
    }
    
    console.log(`Completed processing ${urls.length} URLs`);
    if (saveToDatabase) {
      console.log(`Saved ${totalRowsSaved} total rows to database`);
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        summary: {
          total: urls.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          totalRowsSaved: saveToDatabase ? totalRowsSaved : 0
        }
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  } catch (error) {
    console.error("Error in batch-fetch-gsc:", error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 400, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});

/**
 * Transform GSC data for database insertion
 */
function transformGSCDataForDB(rows, fetchDate, clientId, siteUrl) {
  if (!rows || rows.length === 0) {
    return [];
  }
  
  // Map rows to database format
  return rows.map(row => {
    // Check if we have both page and query dimensions
    const hasPageQuery = row.keys && row.keys.length >= 2;
    
    // If the dimensions are different, adapt accordingly
    const pageUrl = hasPageQuery ? row.keys[0] : row.keys.find(k => k.startsWith('http')) || '';
    const keyword = hasPageQuery ? row.keys[1] : row.keys.find(k => !k.startsWith('http')) || '';
    
    return {
      client_id: clientId,
      site_url: siteUrl,
      fetched_date: fetchDate,
      page_url: pageUrl,
      keyword: keyword,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0
    };
  });
}

/**
 * Fetches GSC data for a specific URL
 */
async function fetchGscDataForUrl(
  token: string,
  siteUrl: string, 
  url: string, 
  startDate: string, 
  endDate: string, 
  dimensions: string[],
  filters?: {
    maxPosition?: number;
    minImpressions?: number;
    maxKeywordsPerUrl?: number;
  }
) {
  const encodedSiteUrl = encodeURIComponent(siteUrl);
  const apiUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`;
  
  console.log(`GSC API URL: ${apiUrl}`);
  
  // Create request body
  const requestBody: Record<string, any> = {
    startDate,
    endDate,
    dimensions,
    rowLimit: filters?.maxKeywordsPerUrl || 50,
    startRow: 0,
    dataState: 'final'
  };
  
  // Add URL filter
  requestBody.dimensionFilterGroups = [{
    filters: [{
      dimension: 'page',
      operator: 'equals',
      expression: url
    }]
  }];
  
  // Add position filter if specified
  if (filters?.maxPosition) {
    requestBody.searchType = 'web';
    
    // Add position filter to the same filter group
    requestBody.dimensionFilterGroups[0].filters.push({
      dimension: 'position',
      operator: 'lessThanEqualTo',
      expression: filters.maxPosition.toString()
    });
  }
  
  console.log(`GSC API request: ${JSON.stringify(requestBody, null, 2)}`);
  
  // Make the API request
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GSC API error: ${response.status} ${errorText}`);
  }
  
  const data = await response.json();
  console.log(`GSC API response for ${url}: ${data.rows?.length || 0} rows`);
  
  // Filter by impressions if specified
  let rows = data.rows || [];
  if (filters?.minImpressions && filters.minImpressions > 0) {
    const originalCount = rows.length;
    rows = rows.filter(row => row.impressions >= filters.minImpressions);
    console.log(`Filtered rows by min impressions (${filters.minImpressions}): ${originalCount} → ${rows.length}`);
  }
  
  // Calculate metrics
  const metrics = {
    totalImpressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    totalClicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    avgPosition: rows.length ? rows.reduce((sum, row) => sum + row.position, 0) / rows.length : 0,
    keywordCount: rows.length
  };
  
  return {
    metrics,
    rows
  };
}