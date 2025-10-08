// Get Sitemaps API for Google Search Console
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { getGSCAccessToken, checkSiteUrl, corsHeaders } from '../utils-gsc/index.ts';

interface RequestBody {
  siteUrl: string;
}

/**
 * Gets a list of sitemaps for a site from GSC API.
 * @param accessToken Access token for GSC API
 * @param siteUrl Site URL in GSC
 * @returns List of sitemap URLs
 */
async function getSitemaps(accessToken: string, siteUrl: string): Promise<any> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.error(`Error getting sitemaps: ${response.status}`);
    if (response.status === 403) {
      throw new Error('Service account does not have access to this site');
    }
    throw new Error(`Failed to get sitemaps: ${response.statusText}`);
  }

  const body = await response.json();

  if (!body.sitemap) {
    return [];
  }

  return body.sitemap
    .filter((x: any) => x.path !== undefined && x.path !== null)
    .map((x: any) => ({
      path: x.path,
      lastSubmitted: x.lastSubmitted,
      lastDownloaded: x.lastDownloaded,
      warnings: x.warnings || 0,
      errors: x.errors || 0,
      isSitemapsIndex: x.isSitemapsIndex || false,
      isPending: x.isPending || false,
      contents: x.contents || []
    }));
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
    
    if (!data.siteUrl) {
      throw new Error('Site URL is required');
    }

    // Get GSC access token
    const accessToken = await getGSCAccessToken();

    // Verify site URL format and access
    const siteUrl = await checkSiteUrl(accessToken, data.siteUrl);
    
    // Get sitemaps
    const sitemaps = await getSitemaps(accessToken, siteUrl);

    return new Response(
      JSON.stringify({
        success: true,
        siteUrl,
        sitemapCount: sitemaps.length,
        sitemaps
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