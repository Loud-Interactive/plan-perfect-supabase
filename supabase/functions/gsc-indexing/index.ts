// GSC Indexing Edge Function
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define interfaces for request and response types
interface RequestIndexingBody {
  url: string;
  siteUrl?: string;
}

interface GetSitemapsBody {
  siteUrl: string;
}

interface CheckIndexationBody {
  url: string;
  siteUrl?: string;
}

async function getGSCAccessToken(): Promise<string> {
  // Get service account credentials from environment variables
  const clientEmail = Deno.env.get('GSC_CLIENT_EMAIL');
  const privateKey = Deno.env.get('GSC_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  
  if (!clientEmail || !privateKey) {
    throw new Error('Missing GSC service account credentials');
  }
  
  // Create JWT token for authentication
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const expiryTime = now + 3600; // 1 hour expiry
  
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    exp: expiryTime,
    iat: now,
  };
  
  // Encode header and claim
  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const claimB64 = btoa(JSON.stringify(claim)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  // Create signature
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    encoder.encode(`${headerB64}.${claimB64}`)
  );
  
  // Convert signature to Base64URL
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Create JWT
  const jwt = `${headerB64}.${claimB64}.${signatureB64}`;
  
  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  
  const tokenData = await tokenResponse.json();
  
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error('Token response error:', tokenData);
    throw new Error(`Failed to get access token: ${tokenData.error || 'Unknown error'}`);
  }
  
  return tokenData.access_token;
}

// Helper function to convert PEM to ArrayBuffer
function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Remove header, footer, and newlines from PEM
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  
  // Convert Base64 to binary string
  const binaryString = atob(base64);
  
  // Convert binary string to ArrayBuffer
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes.buffer;
}

async function getSiteUrlList(accessToken: string): Promise<string[]> {
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  if (!response.ok) {
    console.error(`Error getting sites: ${response.status}`);
    if (response.status === 403) {
      throw new Error('Service account does not have access to any sites');
    }
    throw new Error(`Failed to get sites: ${response.statusText}`);
  }
  
  const sitesBody = await response.json();
  
  if (!sitesBody.siteEntry || sitesBody.siteEntry.length === 0) {
    return [];
  }
  
  return sitesBody.siteEntry.map((x: any) => x.siteUrl);
}

async function checkSiteUrl(accessToken: string, siteUrl: string): Promise<string> {
  const sites = await getSiteUrlList(accessToken);
  let formattedUrls: string[] = [];

  // Convert the site URL into all possible formats
  if (siteUrl.startsWith('https://')) {
    formattedUrls.push(siteUrl);
    formattedUrls.push(`http://${siteUrl.replace('https://', '')}`);
    formattedUrls.push(`sc-domain:${siteUrl.replace('https://', '').replace('/', '')}`);
  } else if (siteUrl.startsWith('http://')) {
    formattedUrls.push(siteUrl);
    formattedUrls.push(`https://${siteUrl.replace('http://', '')}`);
    formattedUrls.push(`sc-domain:${siteUrl.replace('http://', '').replace('/', '')}`);
  } else if (siteUrl.startsWith('sc-domain:')) {
    formattedUrls.push(siteUrl);
    formattedUrls.push(`http://${siteUrl.replace('sc-domain:', '')}`);
    formattedUrls.push(`https://${siteUrl.replace('sc-domain:', '')}`);
  } else {
    // Try to guess the format
    formattedUrls.push(`https://${siteUrl}`);
    formattedUrls.push(`http://${siteUrl}`);
    formattedUrls.push(`sc-domain:${siteUrl.replace('/', '')}`);
  }

  // Check if any of the formatted URLs are accessible
  for (const formattedUrl of formattedUrls) {
    if (sites.includes(formattedUrl)) {
      return formattedUrl;
    }
  }

  throw new Error('Service account does not have access to this site');
}

async function getSitemaps(accessToken: string, siteUrl: string): Promise<string[]> {
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
    .map((x: any) => x.path as string);
}

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

    // Parse request URL to extract path
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(p => p);
    const path = pathParts[pathParts.length - 1] || '';
    
    // Parse request body
    const reqData = await req.json();

    // Get GSC access token
    const accessToken = await getGSCAccessToken();

    // Route based on path and action
    if (path === 'request-indexing') {
      const data = reqData as RequestIndexingBody;
      
      if (!data.url) {
        throw new Error('URL is required');
      }

      let siteUrl = '';
      if (data.siteUrl) {
        // Verify site URL format and access
        siteUrl = await checkSiteUrl(accessToken, data.siteUrl);
      } else {
        // Extract domain from URL and check access
        const urlObj = new URL(data.url);
        siteUrl = await checkSiteUrl(accessToken, urlObj.hostname);
      }

      const result = await requestIndexing(accessToken, data.url);

      return new Response(
        JSON.stringify({
          success: true,
          url: data.url,
          result
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (path === 'get-sitemaps') {
      const data = reqData as GetSitemapsBody;
      
      if (!data.siteUrl) {
        throw new Error('Site URL is required');
      }

      // Verify site URL format and access
      const siteUrl = await checkSiteUrl(accessToken, data.siteUrl);
      const sitemaps = await getSitemaps(accessToken, siteUrl);

      return new Response(
        JSON.stringify({
          success: true,
          siteUrl: siteUrl,
          sitemaps
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else if (path === 'check-indexation') {
      const data = reqData as CheckIndexationBody;
      
      if (!data.url) {
        throw new Error('URL is required');
      }

      let siteUrl = '';
      if (data.siteUrl) {
        // Verify site URL format and access
        siteUrl = await checkSiteUrl(accessToken, data.siteUrl);
      } else {
        // Extract domain from URL and check access
        const urlObj = new URL(data.url);
        siteUrl = await checkSiteUrl(accessToken, urlObj.hostname);
      }

      const status = await checkIndexingStatus(accessToken, siteUrl, data.url);

      return new Response(
        JSON.stringify({
          success: true,
          url: data.url,
          siteUrl,
          status
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      throw new Error('Invalid path or action');
    }
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