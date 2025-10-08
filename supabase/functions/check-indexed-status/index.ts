// supabase/functions/check-indexed-status/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logError, retryWithBackoff } from '../utils/error-handling.ts';

// Constants for search and retries
const SEARCH_MAX_RETRIES = 3;
const SEARCH_RETRY_DELAY = 2000; // ms

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Edge function to check if a URL is indexed in Google
 * Uses ScaleSERP API to perform site:{url} search
 * Supports direct URL checking or looking up URLs via content_plan_outline_guid
 */
serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    // Parse request
    const requestData = await req.json();
    
    // Support both original API (content_plan_outline_guid) and direct URL checking
    let urlToCheck = '';
    
    if (requestData.url) {
      // Direct URL input
      urlToCheck = requestData.url;
      console.log(`Checking indexation for direct URL: ${urlToCheck}`);
    } else if (requestData.content_plan_outline_guid) {
      // Original task-based lookup via content_plan_outline_guid
      const content_plan_outline_guid = requestData.content_plan_outline_guid;
      
      if (!content_plan_outline_guid) {
        return new Response(
          JSON.stringify({ error: 'Missing content_plan_outline_guid parameter' }),
          { 
            status: 400, 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            } 
          }
        );
      }

      console.log(`Looking up URL for content_plan_outline_guid: ${content_plan_outline_guid}`);
      
      // Get environment variables
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase credentials');
      }

      // Initialize Supabase client
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      // Get live_post_url from tasks table
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('live_post_url')
        .eq('content_plan_outline_guid', content_plan_outline_guid)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (taskError || !task) {
        throw new Error(`Failed to get task: ${taskError?.message || 'No task found'}`);
      }
      
      if (!task.live_post_url) {
        return new Response(
          JSON.stringify({ indexed: false, message: 'No live_post_url found for this task' }),
          { 
            status: 200, 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            } 
          }
        );
      }
      
      urlToCheck = task.live_post_url;
      console.log(`Found URL in tasks table: ${urlToCheck}`);
    } else {
      return new Response(
        JSON.stringify({ error: 'Missing url or content_plan_outline_guid parameter' }),
        { 
          status: 400, 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          } 
        }
      );
    }
    
    // Get ScaleSERP API Key
    const scaleSerpApiKey = Deno.env.get('SCALESERP_API_KEY') || '';
    
    if (!scaleSerpApiKey) {
      throw new Error('Missing SCALESERP_API_KEY');
    }
    
    // Validate URL format
    try {
      new URL(urlToCheck);
    } catch (e) {
      throw new Error(`Invalid URL format: ${urlToCheck}`);
    }
    
    // Construct site search query - we use the full URL for most precise matching
    const searchQuery = `site:${urlToCheck}`;
    console.log(`Using search query: ${searchQuery}`);
    
    // Get search results using ScaleSERP API
    const results = await getSearchResults(searchQuery, scaleSerpApiKey);
    
    // Check if URL is indexed
    const indexed = checkIfUrlIsIndexed(results, urlToCheck);
    console.log(`URL indexation check result: ${indexed ? 'Indexed' : 'Not indexed'}`);
    
    // We don't update the tasks table for direct URL checks
    // Just return the result
    return new Response(
      JSON.stringify({ 
        indexed, 
        url: urlToCheck,
        message: indexed ? 'URL is indexed in Google' : 'URL is not indexed in Google' 
      }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
    
  } catch (error) {
    console.error(`Error in check-indexed-status: ${error.message}`);
    await logError('check-indexed-status', null, error, { request: req });
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});

/**
 * Gets search results from ScaleSERP API for a given search term
 * 
 * @param searchTerm The search term to use
 * @param apiKey The ScaleSERP API key
 * @returns Array of search results or null if error
 */
async function getSearchResults(searchTerm: string, apiKey: string) {
  // Remove quotes and clean up search term
  searchTerm = searchTerm.replace(/"/g, '').replace(/'/g, '').trim();
  
  return await retryWithBackoff(async () => {
    const params = {
      'api_key': apiKey,
      'q': searchTerm,
      'gl': 'us',
      'google_domain': 'google.com',
      'num': 20  // Request more results
    };
    
    console.log(`Fetching search results for term: ${searchTerm}`);
    
    const url = new URL('https://api.scaleserp.com/search');
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value.toString());
    });
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      throw new Error(`ScaleSERP API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.organic_results || !Array.isArray(data.organic_results)) {
      console.log(`No organic_results in response. Response data: ${JSON.stringify(data, null, 2)}`);
      return [];
    }
    
    console.log(`Successfully got ${data.organic_results.length} results`);
    return data.organic_results;
  }, SEARCH_MAX_RETRIES, SEARCH_RETRY_DELAY);
}

/**
 * Checks if a URL exists in search results
 * 
 * @param results Search results from ScaleSERP API
 * @param url The URL to check
 * @returns boolean indicating if URL is indexed
 */
function checkIfUrlIsIndexed(results: any[], url: string): boolean {
  if (!results || results.length === 0) {
    return false;
  }
  
  // Normalize URLs for comparison (remove trailing slashes, protocol, etc.)
  const normalizeUrl = (inputUrl: string): string => {
    try {
      // Remove protocol, www, and trailing slash
      return inputUrl
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(/\/+$/, '')
        .toLowerCase();
    } catch (e) {
      return inputUrl.toLowerCase();
    }
  };
  
  const normalizedTargetUrl = normalizeUrl(url);
  
  // Check if any result matches our URL
  return results.some(result => {
    if (!result.link) return false;
    const normalizedResultUrl = normalizeUrl(result.link);
    return normalizedResultUrl === normalizedTargetUrl;
  });
}