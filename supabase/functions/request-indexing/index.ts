// Request Indexing API for Google Search Console
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getGSCAccessToken, checkSiteUrl, extractDomain, corsHeaders } from '../utils-gsc/index.ts';

interface RequestBody {
  url: string;
  siteUrl?: string;
}

/**
 * Requests indexing for a URL via Google's Indexing API.
 * @param accessToken Access token for GSC API
 * @param url URL to request indexing for
 * @returns Response from the Indexing API
 */
async function requestIndexing(accessToken: string, url: string): Promise<any> {
  const response = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      url: url,
      type: 'URL_UPDATED',
    }),
  });

  if (!response.ok) {
    console.error(`Error requesting indexing: ${response.status}`);
    if (response.status === 403) {
      throw new Error('Service account does not have access to this site');
    } else if (response.status === 429) {
      throw new Error('Rate limit exceeded, try again later');
    }
    throw new Error(`Failed to request indexing: ${response.statusText}`);
  }

  return await response.json();
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

    // Request indexing
    const result = await requestIndexing(accessToken, data.url);

    // Log the request in the database (optional)
    try {
      await supabaseClient
        .from('indexing_requests')
        .insert({
          url: data.url,
          site_url: siteUrl,
          status: 'requested',
          response: result
        });
    } catch (dbError) {
      console.error(`Error logging request to database: ${dbError.message}`);
      // Continue even if database logging fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: data.url,
        siteUrl,
        result
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