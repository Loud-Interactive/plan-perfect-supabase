// Enhanced fetch-gsc-data function with improved rate limit handling
// Only falls back to AI keywords when genuinely no GSC data exists (not rate limits)
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getGoogleAccessToken } from '../fetch-gsc-data/helpers/googleauth.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
    const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    
    let params = {};
    try {
      params = await req.json();
    } catch (e) {
      params = {};
    }
    
    const { pageId, url } = params;
    
    if (!pageId && !url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Either pageId or url is required',
          errorType: 'validation'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Get or create the page
    let page;
    
    if (pageId) {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('id', pageId)
        .single();
        
      if (error) throw new Error(`Error getting page: ${error.message}`);
      if (!data) throw new Error(`Page with ID ${pageId} not found`);
      
      page = data;
    } else {
      const { data, error } = await supabase
        .from('pages')
        .select('*')
        .eq('url', url)
        .single();
        
      if (error || !data) {
        const { data: newPage, error: createError } = await supabase
          .from('pages')
          .insert({ url })
          .select()
          .single();
          
        if (createError) throw new Error(`Error creating page: ${createError.message}`);
        
        page = newPage;
      } else {
        page = data;
      }
    }
    
    console.log(`Fetching GSC data for page ${page.id}, URL: ${page.url}`);

    const domain = extractDomain(page.url);
    const path = extractPath(page.url);
    
    console.log(`Domain: ${domain}, Path: ${path}`);
    
    // Store URL variations to check for GSC data
    const urlVariations = [
      page.url,
      page.url.replace('https://', 'http://'),
      page.url.replace('https://www.', 'https://'),
      page.url.replace('https://www.', 'http://'),
      page.url.endsWith('/') ? page.url.slice(0, -1) : page.url,
      page.url.endsWith('/') ? page.url : `${page.url}/`
    ];
    
    console.log(`URL variations to check: ${urlVariations.join(', ')}`);
    
    // Calculate date range - last 16 months
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 480);
    
    const formattedStartDate = startDate.toISOString().split('T')[0];
    const formattedEndDate = endDate.toISOString().split('T')[0];
    
    console.log(`Fetching GSC data from ${formattedStartDate} to ${formattedEndDate}`);
    
    let keywordsFromAPI = [];
    let gscResult = { success: false, errorType: 'unknown' };
    
    // Enhanced GSC API fetching with rate limit handling
    try {
      console.log("Attempting to fetch fresh data from GSC API...");
      
      let credentials;
      try {
        credentials = JSON.parse(Deno.env.get('GSC_CREDENTIALS') || '{}');
        if (Object.keys(credentials).length === 0) {
          throw new Error('GSC_CREDENTIALS environment variable is missing or invalid');
        }
      } catch (e) {
        console.error("Error parsing GSC credentials:", e);
        throw new Error('Invalid GSC_CREDENTIALS format');
      }
      
      const token = await getGoogleAccessToken(credentials);
      console.log(`Successfully obtained access token`);
      
      const gscSiteUrl = `sc-domain:${domain}`;
      const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
      const apiUrl = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`;
      
      console.log(`GSC API URL: ${apiUrl}`);
      
      // Try each URL variation with enhanced error handling
      for (const urlVariation of urlVariations) {
        console.log(`Trying GSC API with URL variation: ${urlVariation}`);
        
        const requestBody = {
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          dimensions: ['query'],
          rowLimit: 100,
          dimensionFilterGroups: [{
            filters: [{
              dimension: 'page',
              operator: 'equals',
              expression: urlVariation
            }]
          }]
        };
        
        // Enhanced fetch with retry logic
        const result = await fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (result.success) {
          const data = result.data;
          
          if (data.rows && data.rows.length > 0) {
            console.log(`Found ${data.rows.length} rows from GSC API for ${urlVariation}`);
            
            keywordsFromAPI = data.rows.map(row => ({
              page_id: page.id,
              keyword: row.keys[0],
              clicks: row.clicks || 0,
              impressions: row.impressions || 0,
              "position": row.position || 0,
              ctr: row.ctr || 0,
              fetched_at: formattedEndDate
            }));
            
            console.log(`Successfully transformed ${keywordsFromAPI.length} keywords from GSC API`);
            gscResult = { success: true, source: 'api', dataFound: true };
            break;
          } else {
            console.log(`No data found for ${urlVariation} in GSC API`);
            gscResult = { success: true, source: 'api', dataFound: false };
          }
        } else {
          gscResult = result;
          if (result.errorType === 'rate_limit') {
            console.log(`Rate limited for ${urlVariation}, will retry later`);
            break; // Stop trying variations if rate limited
          }
        }
      }
      
    } catch (apiError) {
      console.error(`Error fetching from GSC API: ${apiError.message}`);
      gscResult = { success: false, errorType: 'api_error', error: apiError.message };
    }
    
    // Insert API data into database if we got any
    if (keywordsFromAPI.length > 0) {
      try {
        console.log(`Storing ${keywordsFromAPI.length} keywords from API to database`);
        
        // Store keywords using upsert
        const { error: insertError } = await supabase
          .from('gsc_keywords')
          .upsert(keywordsFromAPI, {
            onConflict: 'page_id,keyword,fetched_at'
          });
          
        if (insertError) {
          console.error('Error inserting GSC keywords:', insertError);
        } else {
          console.log('Successfully stored GSC keywords');
        }
        
      } catch (insertError) {
        console.error(`Error storing API data: ${insertError.message}`);
      }
    }
    
    // Determine if we should fall back to database or AI keywords
    let finalKeywords = keywordsFromAPI;
    let source = 'api';
    
    if (keywordsFromAPI.length === 0) {
      // Check database for existing keywords
      const { data: existingKeywords, error: dbError } = await supabase
        .from('gsc_keywords')
        .select('*')
        .eq('page_id', page.id)
        .order('fetched_at', { ascending: false })
        .limit(100);
        
      if (!dbError && existingKeywords && existingKeywords.length > 0) {
        console.log(`Found ${existingKeywords.length} existing keywords in database`);
        finalKeywords = existingKeywords;
        source = 'database';
      } else if (gscResult.errorType !== 'rate_limit') {
        // Only generate AI keywords if we genuinely have no GSC data and weren't rate limited
        console.log('No GSC data found and no rate limit - generating AI keywords');
        
        try {
          const aiKeywords = await generateAIKeywords(page);
          if (aiKeywords && aiKeywords.length > 0) {
            finalKeywords = aiKeywords;
            source = 'ai_generated';
            console.log(`Generated ${aiKeywords.length} AI keywords`);
          }
        } catch (aiError) {
          console.error('Error generating AI keywords:', aiError.message);
        }
      }
    }
    
    // Return enhanced response with detailed status
    return new Response(
      JSON.stringify({
        success: true,
        message: `GSC data processing completed`,
        keywordCount: finalKeywords.length,
        source: source,
        gscResult: gscResult,
        pageId: page.id,
        pageUrl: page.url,
        dataAge: finalKeywords.length > 0 && finalKeywords[0].fetched_at ? 
          Math.floor((Date.now() - new Date(finalKeywords[0].fetched_at).getTime()) / (1000 * 60 * 60 * 24)) : null
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
    
  } catch (error) {
    console.error('Function error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        errorType: 'function_error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

// Enhanced fetch with exponential backoff for rate limiting
async function fetchWithRetry(url: string, options: any): Promise<any> {
  let lastError;
  
  for (let attempt = 0; attempt < RATE_LIMIT_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, data };
      }
      
      const errorText = await response.text();
      
      // Check for rate limiting
      if (response.status === 429 || errorText.includes('quota') || errorText.includes('rate limit')) {
        const delay = Math.min(
          RATE_LIMIT_CONFIG.baseDelayMs * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt),
          RATE_LIMIT_CONFIG.maxDelayMs
        );
        
        console.log(`Rate limited (attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.maxRetries}), waiting ${delay}ms`);
        
        if (attempt < RATE_LIMIT_CONFIG.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } else {
          return { 
            success: false, 
            errorType: 'rate_limit', 
            error: `Rate limited after ${RATE_LIMIT_CONFIG.maxRetries} attempts`,
            retryAfter: delay 
          };
        }
      }
      
      // Other HTTP errors
      return { 
        success: false, 
        errorType: 'http_error', 
        error: `HTTP ${response.status}: ${errorText}` 
      };
      
    } catch (fetchError) {
      lastError = fetchError;
      console.error(`Fetch attempt ${attempt + 1} failed:`, fetchError.message);
      
      if (attempt < RATE_LIMIT_CONFIG.maxRetries - 1) {
        const delay = RATE_LIMIT_CONFIG.baseDelayMs * Math.pow(RATE_LIMIT_CONFIG.backoffMultiplier, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  return { 
    success: false, 
    errorType: 'network_error', 
    error: lastError?.message || 'Network error after retries' 
  };
}

// Generate AI keywords when no GSC data is available (not rate limited)
async function generateAIKeywords(page: any): Promise<any[]> {
  // This would call your existing AI keyword generation logic
  // Only when we genuinely have no GSC data available
  console.log('AI keyword generation would happen here for page:', page.url);
  return []; // Placeholder - implement your AI keyword logic
}

// Helper functions (copied from original)
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    console.error('Error extracting domain from URL:', url, e);
    return '';
  }
}

function extractPath(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch (e) {
    console.error('Error extracting path from URL:', url, e);
    return '';
  }
}