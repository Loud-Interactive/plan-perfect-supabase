// debug-gsc-api
// Advanced debugging tool for GSC API calls with comprehensive diagnostics

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
      dimensions, 
      rowLimit = 10,
      gscCredentials,
      testAllFormats = false, // Option to test multiple URL formats
      testPropertyTypes = false // Option to test domain vs URL-prefix
    } = await req.json();
    
    if (!siteUrl || !startDate || !endDate) {
      throw new Error('siteUrl, startDate, and endDate are required');
    }
    
    // Use credentials from request or environment variable
    let credentials;
    try {
      credentials = gscCredentials 
        ? (typeof gscCredentials === 'string' ? JSON.parse(gscCredentials) : gscCredentials)
        : JSON.parse(Deno.env.get('GSC_CREDENTIALS') || '{}');
      
      if (Object.keys(credentials).length === 0) {
        throw new Error('GSC_CREDENTIALS environment variable is missing or invalid');
      }
    } catch (error) {
      throw new Error(`Error parsing GSC credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    console.log(`Debugging GSC API for ${siteUrl} from ${startDate} to ${endDate}`);
    
    // Get OAuth2 token for Google API
    let token;
    try {
      token = await getGoogleAccessToken(credentials);
      console.log(`Generated token successfully: ${token.substring(0, 10)}...`);
    } catch (error) {
      throw new Error(`Error generating token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // First, test accessibility by fetching list of sites
    let availableSites = [];
    let hasSiteAccess = false;
    let exactMatchingSite = null;
    let suggestedSiteFormats = [];
    
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
        
        availableSites = sitesList.siteEntry?.map(site => ({
          url: site.siteUrl,
          permissionLevel: site.permissionLevel,
          siteType: site.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url-prefix'
        })) || [];
        
        // Check if our target site is in the list (exact match)
        const exactMatch = sitesList.siteEntry?.find(site => site.siteUrl === siteUrl);
        
        // Check for partial matches (domain match but different format)
        const targetDomain = extractDomain(siteUrl);
        const partialMatches = sitesList.siteEntry?.filter(site => {
          const siteDomain = extractDomain(site.siteUrl);
          return siteDomain === targetDomain && site.siteUrl !== siteUrl;
        });
        
        if (exactMatch) {
          console.log(`Found exact match for site in GSC: ${exactMatch.siteUrl} with permission level: ${exactMatch.permissionLevel}`);
          hasSiteAccess = true;
          exactMatchingSite = {
            url: exactMatch.siteUrl,
            permissionLevel: exactMatch.permissionLevel,
            siteType: exactMatch.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url-prefix'
          };
        } else if (partialMatches && partialMatches.length > 0) {
          console.log(`Found ${partialMatches.length} partial domain matches but not exact format match.`);
          partialMatches.forEach(match => {
            console.log(`  - ${match.siteUrl} (${match.permissionLevel})`);
            suggestedSiteFormats.push({
              url: match.siteUrl,
              permissionLevel: match.permissionLevel,
              siteType: match.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url-prefix'
            });
          });
          hasSiteAccess = false;
        } else {
          console.log(`WARNING: Site "${siteUrl}" not found in accessible GSC sites list.`);
          hasSiteAccess = false;
        }
      } else {
        const errorText = await testResponse.text();
        throw new Error(`Could not fetch GSC sites list: ${testResponse.status} ${errorText}`);
      }
    } catch (error) {
      throw new Error(`Error testing GSC API access: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Generate URL format variations to test if requested
    const siteUrlsToTest = [siteUrl];
    
    if (testAllFormats || !hasSiteAccess) {
      // Extract base domain and generate different formats
      try {
        const baseDomain = extractBaseDomain(siteUrl);
        
        if (baseDomain) {
          // Test common URL formats that might be registered in GSC
          if (!siteUrlsToTest.includes(`sc-domain:${baseDomain}`)) 
            siteUrlsToTest.push(`sc-domain:${baseDomain}`);
            
          if (!siteUrlsToTest.includes(`https://${baseDomain}/`)) 
            siteUrlsToTest.push(`https://${baseDomain}/`);
            
          if (!siteUrlsToTest.includes(`https://www.${baseDomain}/`)) 
            siteUrlsToTest.push(`https://www.${baseDomain}/`);
            
          // Add suggested formats from available sites
          suggestedSiteFormats.forEach(suggestion => {
            if (!siteUrlsToTest.includes(suggestion.url)) {
              siteUrlsToTest.push(suggestion.url);
            }
          });
        }
      } catch (e) {
        console.log(`Could not generate alternative formats: ${e}`);
      }
    }
    
    // Try different dimension combinations
    const dimensionSets = dimensions ? [dimensions] : [
      ['page', 'query'],
      ['query'],
      ['page'],
      ['date', 'query'],
      ['device', 'query'],
      ['country', 'query']
    ];
    
    const results = [];
    
    // Test each URL format with key dimension combinations
    for (const testSiteUrl of siteUrlsToTest) {
      for (const dims of dimensionSets) {
        try {
          console.log(`Testing site URL "${testSiteUrl}" with dimensions: ${dims.join(', ')}`);
          
          const encodedSiteUrl = encodeURIComponent(testSiteUrl);
          const url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' + 
                      encodedSiteUrl + '/searchAnalytics/query';
          
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: startDate,
              endDate: endDate,
              dimensions: dims,
              rowLimit: rowLimit,
              startRow: 0,
              dataState: 'final',
            }),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            let parsedError = {};
            try {
              parsedError = JSON.parse(errorText);
            } catch (e) {
              parsedError = { rawError: errorText };
            }
            
            console.log(`Error response for site "${testSiteUrl}" dimensions ${dims.join(', ')}: ${response.status} ${errorText}`);
            
            results.push({
              siteUrl: testSiteUrl,
              dimensions: dims,
              success: false,
              error: `${response.status} ${errorText}`,
              errorData: parsedError,
              data: null
            });
            continue;
          }
          
          const data = await response.json();
          
          console.log(`Got response for site "${testSiteUrl}" dimensions ${dims.join(', ')}: ${data.rows?.length || 0} rows`);
          
          // Check if any rows were returned
          const hasRows = data.rows && data.rows.length > 0;
          
          results.push({
            siteUrl: testSiteUrl,
            dimensions: dims,
            success: true,
            rowCount: data.rows?.length || 0,
            hasData: hasRows,
            data: data.rows || [],
            responseAggregationType: data.responseAggregationType
          });
          
          // If we found data with this URL format, prioritize it for further tests
          if (hasRows && testSiteUrl !== siteUrl) {
            console.log(`Found working URL format "${testSiteUrl}" - this format has data!`);
          }
        } catch (error) {
          console.error(`Error querying "${testSiteUrl}" with dimensions ${dims.join(', ')}:`, error);
          results.push({
            siteUrl: testSiteUrl,
            dimensions: dims,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: null
          });
        }
      }
    }
    
    // Test with broader date ranges for each site URL
    for (const testSiteUrl of siteUrlsToTest) {
      // Only test date ranges on URL formats that didn't error but had no data
      const hasEmptyResults = results.some(r => 
        r.siteUrl === testSiteUrl && 
        r.success === true && 
        r.rowCount === 0
      );
      
      if (hasEmptyResults) {
        await testBroaderDateRanges(testSiteUrl, token, results);
      }
    }
    
    // Generate diagnostic information
    const diagnostics = generateDiagnostics(results, availableSites, siteUrl);
    
    return new Response(
      JSON.stringify({
        success: true,
        siteUrl,
        startDate,
        endDate,
        hasSiteAccess,
        exactMatchingSite,
        availableSites,
        suggestedSiteFormats,
        serviceAccount: credentials.client_email || 'Unknown',
        results,
        diagnostics
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Debug error:', error);
    
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

// Helper function to test broader date ranges
async function testBroaderDateRanges(siteUrl, token, results) {
  const dateRanges = [
    {name: '3 months', months: 3},
    {name: '6 months', months: 6},
    {name: '12 months', months: 12}
  ];
  
  for (const range of dateRanges) {
    try {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - range.months);
      const broadStartDate = pastDate.toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      
      console.log(`Trying broader ${range.name} date range for ${siteUrl}: ${broadStartDate} to ${today}...`);
      
      const encodedSiteUrl = encodeURIComponent(siteUrl);
      const url = 'https://searchconsole.googleapis.com/webmasters/v3/sites/' + 
                  encodedSiteUrl + '/searchAnalytics/query';
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: broadStartDate,
          endDate: today,
          dimensions: ['query'],
          rowLimit: 10,
          dataState: 'final',
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const hasData = data.rows && data.rows.length > 0;
        
        results.push({
          siteUrl: siteUrl,
          dimensions: ['query'],
          dateRange: `${broadStartDate} to ${today}`,
          dateRangeType: range.name,
          success: true,
          rowCount: data.rows?.length || 0,
          hasData: hasData,
          data: data.rows || []
        });
        
        if (hasData) {
          console.log(`Found data with ${range.name} date range!`);
          // If we found data, no need to test longer ranges
          break;
        }
      }
    } catch (error) {
      console.error(`Error testing with ${range.name} date range:`, error);
      results.push({
        siteUrl: siteUrl,
        dimensions: ['query'],
        dateRange: `${range.name} ago to today`,
        dateRangeType: range.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

// Helper function to extract domain from URL
function extractDomain(url) {
  if (!url) return '';
  
  // Handle sc-domain format
  if (url.startsWith('sc-domain:')) {
    return url.replace('sc-domain:', '').trim().toLowerCase();
  }
  
  // Handle http/https URLs
  try {
    // Add protocol if needed for URL parsing
    let urlWithProtocol = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      urlWithProtocol = 'https://' + url;
    }
    
    const parsedUrl = new URL(urlWithProtocol);
    return parsedUrl.hostname.toLowerCase();
  } catch (e) {
    // If not a valid URL, return as is
    return url.toLowerCase();
  }
}

// Helper function to extract base domain (without www)
function extractBaseDomain(url) {
  const domain = extractDomain(url);
  return domain.replace(/^www\./, '');
}

// Generate comprehensive diagnostics from test results
function generateDiagnostics(results, availableSites, originalSiteUrl) {
  const diagnostics = {
    issues: [],
    recommendations: []
  };
  
  // Check for permission issues
  const hasPermissionErrors = results.some(r => {
    if (!r.success && r.errorData) {
      const errorText = JSON.stringify(r.errorData);
      return errorText.includes('PERMISSION_DENIED') || 
             errorText.includes('403') ||
             errorText.includes('permission');
    }
    return false;
  });
  
  if (hasPermissionErrors) {
    diagnostics.issues.push({
      type: 'permission',
      severity: 'high',
      message: 'Permission denied errors detected when accessing GSC data'
    });
    
    // Extract available sites for recommendation
    const sitesList = availableSites.map(s => s.url).join(', ');
    diagnostics.recommendations.push({
      type: 'permission',
      message: 'Verify service account permissions',
      details: 'The service account may not have access to this GSC property. ' +
               'Ensure the service account email is added with at least "Read & Analyse" permissions in GSC. ' +
               `Available sites: ${sitesList || 'None'}`
    });
  }
  
  // Check for URL format issues
  const exactDomainMatch = availableSites.find(site => 
    extractDomain(site.url) === extractDomain(originalSiteUrl) &&
    site.url !== originalSiteUrl
  );
  
  if (exactDomainMatch) {
    diagnostics.issues.push({
      type: 'url_format',
      severity: 'high',
      message: 'Site URL format mismatch'
    });
    
    diagnostics.recommendations.push({
      type: 'url_format',
      message: 'Use exact GSC URL format',
      details: `The site is registered in GSC as "${exactDomainMatch.url}" but you're using "${originalSiteUrl}". ` +
               'Use the exact format as it appears in GSC.'
    });
  }
  
  // Check for working formats
  const workingFormats = results.filter(r => r.success && r.hasData && r.rowCount > 0);
  if (workingFormats.length > 0) {
    const formats = [...new Set(workingFormats.map(f => f.siteUrl))];
    
    if (!formats.includes(originalSiteUrl)) {
      diagnostics.recommendations.push({
        type: 'working_format',
        message: 'Use a working URL format',
        details: `These URL formats returned data: ${formats.join(', ')}`
      });
    }
  }
  
  // Check for date range issues
  const hasDateRangeData = results.some(r => 
    r.success && r.dateRange && r.rowCount > 0 && r.siteUrl === originalSiteUrl
  );
  
  const hasRegularData = results.some(r => 
    r.success && !r.dateRange && r.rowCount > 0 && r.siteUrl === originalSiteUrl
  );
  
  if (hasDateRangeData && !hasRegularData) {
    diagnostics.issues.push({
      type: 'date_range',
      severity: 'medium',
      message: 'No data in specified date range, but data exists in broader ranges'
    });
    
    // Find the working date range
    const workingRange = results.find(r => 
      r.success && r.dateRange && r.rowCount > 0 && r.siteUrl === originalSiteUrl
    );
    
    diagnostics.recommendations.push({
      type: 'date_range',
      message: 'Use a broader date range',
      details: `No data found in your specified date range, but data exists when using ${workingRange?.dateRangeType || 'a broader'} range. ` +
               'Try expanding your date range or ensure the site has been in GSC long enough to have data.'
    });
  }
  
  // Check for dimension issues
  const workingDimensions = results
    .filter(r => r.success && r.rowCount > 0 && r.siteUrl === originalSiteUrl && !r.dateRange)
    .map(r => r.dimensions.join(','));
  
  if (workingDimensions.length > 0) {
    diagnostics.recommendations.push({
      type: 'dimensions',
      message: 'Use working dimension combinations',
      details: `These dimension combinations returned data: ${[...new Set(workingDimensions)].join('; ')}`
    });
  }
  
  // Check if no data at all with any configuration
  const anySuccessfulData = results.some(r => r.success && r.rowCount > 0);
  
  if (!anySuccessfulData) {
    diagnostics.issues.push({
      type: 'no_data',
      severity: 'high',
      message: 'No data found with any configuration'
    });
    
    diagnostics.recommendations.push({
      type: 'no_data',
      message: 'Verify GSC setup and indexing',
      details: 'No data could be found with any configuration. This could indicate that: ' +
               '1) The site is not correctly set up in GSC, ' +
               '2) The site is new and has no search data yet, or ' +
               '3) There are permission issues with the service account.'
    });
  }
  
  return diagnostics;
}