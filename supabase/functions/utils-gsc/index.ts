// Utility functions for Google Search Console API integration

/**
 * Gets an access token for Google Search Console API using service account credentials.
 * @returns Promise<string> Access token
 */
export async function getGSCAccessToken(): Promise<string> {
  // Get service account credentials from environment variables
  const gscCredentials = Deno.env.get('GSC_CREDENTIALS');
  
  if (!gscCredentials) {
    throw new Error('Missing GSC_CREDENTIALS environment variable');
  }
  
  // Parse the JSON credentials with more robust error handling
  let credentials;
  try {
    credentials = typeof gscCredentials === 'string' 
      ? JSON.parse(gscCredentials) 
      : gscCredentials;
    
    if (Object.keys(credentials).length === 0) {
      throw new Error('GSC_CREDENTIALS environment variable is empty or invalid');
    }
  } catch (e) {
    throw new Error(`Invalid GSC_CREDENTIALS JSON format: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
  
  const { client_email, private_key } = credentials;
  
  if (!client_email || !private_key) {
    throw new Error('Missing client_email or private_key in GSC_CREDENTIALS');
  }
  
  console.log(`Using service account: ${client_email}`);
  
  // Create JWT token for authentication
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const expiryTime = now + 3600; // 1 hour expiry
  
  const claim = {
    iss: client_email,
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
    pemToArrayBuffer(private_key),
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

/**
 * Converts a PEM private key to ArrayBuffer.
 * @param pem PEM format private key
 * @returns ArrayBuffer representation of the key
 */
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

/**
 * Gets a list of sites the service account has access to.
 * @param accessToken Access token for GSC API
 * @returns Array of site URLs
 */
export async function getSiteUrlList(accessToken: string): Promise<string[]> {
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

/**
 * Checks if the site URL is accessible and converts to a format GSC accepts.
 * @param accessToken Access token for GSC API
 * @param siteUrl Site URL to check
 * @returns Properly formatted site URL that GSC accepts
 */
export async function checkSiteUrl(accessToken: string, siteUrl: string): Promise<string> {
  // Fetch all available sites from GSC API
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Could not fetch GSC sites list: ${response.status} ${errorText}`);
  }
  
  const sitesList = await response.json();
  console.log(`Found ${sitesList.siteEntry?.length || 0} sites in GSC account`);
  
  // Check for exact match first
  const exactMatch = sitesList.siteEntry?.find((site: any) => site.siteUrl === siteUrl);
  if (exactMatch) {
    console.log(`Found exact match for site in GSC: ${exactMatch.siteUrl} with permission level: ${exactMatch.permissionLevel}`);
    return exactMatch.siteUrl;
  }
  
  // Extract domain from the given URL for partial matching
  const targetDomain = extractBaseDomain(siteUrl);
  
  // Look for partial matches (domain match but different format)
  const partialMatches = sitesList.siteEntry?.filter((site: any) => {
    const siteDomain = extractBaseDomain(site.siteUrl);
    return siteDomain === targetDomain && site.siteUrl !== siteUrl;
  });
  
  if (partialMatches && partialMatches.length > 0) {
    console.log(`Found ${partialMatches.length} partial domain matches but not exact format match.`);
    
    // Prefer sc-domain: format as it's more flexible
    const domainPropertyMatch = partialMatches.find((match: any) => match.siteUrl.startsWith('sc-domain:'));
    if (domainPropertyMatch) {
      console.log(`Using domain property: ${domainPropertyMatch.siteUrl}`);
      return domainPropertyMatch.siteUrl;
    }
    
    // Otherwise use the first match
    console.log(`Using URL-prefix property: ${partialMatches[0].siteUrl}`);
    return partialMatches[0].siteUrl;
  }
  
  // If no matches, try to generate alternative formats to test
  const siteUrlsToTest = [siteUrl];
  
  try {
    const baseDomain = extractBaseDomain(siteUrl);
    
    if (baseDomain) {
      // Try sc-domain: format
      siteUrlsToTest.push(`sc-domain:${baseDomain}`);
      
      // Try https://domain/ format
      if (!siteUrl.includes('https://')) {
        siteUrlsToTest.push(`https://${baseDomain}/`);
      }
      
      // Try https://www.domain/ format
      if (!siteUrl.includes('www.')) {
        siteUrlsToTest.push(`https://www.${baseDomain}/`);
      }
    }
  } catch (e) {
    console.log(`Could not generate alternative formats: ${e}`);
  }
  
  // Log all the formats we'll try
  console.log(`Testing URL formats: ${siteUrlsToTest.join(', ')}`);
  
  // Try each format with a test API call
  for (const testUrl of siteUrlsToTest) {
    try {
      const encodedSiteUrl = encodeURIComponent(testUrl);
      const testApiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/urlInspection/index:inspect`;
      
      // Just make a test request to see if we have access
      const testResponse = await fetch(testApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inspectionUrl: "https://example.com/",
          siteUrl: testUrl,
        }),
      });
      
      // If we get a 400 but not a 403, it might be valid format but just invalid URL
      // This suggests we have access to the site but the URL is invalid
      if (testResponse.status === 400) {
        const errorText = await testResponse.text();
        if (!errorText.includes("PERMISSION_DENIED")) {
          console.log(`Found working URL format: ${testUrl}`);
          return testUrl;
        }
      }
      
      // Direct success case
      if (testResponse.ok) {
        console.log(`Found working URL format: ${testUrl}`);
        return testUrl;
      }
    } catch (e) {
      console.log(`Error testing URL format ${testUrl}: ${e}`);
      // Continue to the next format
    }
  }
  
  // If we reach here, we couldn't find a working format
  console.error(`Available sites in GSC: ${sitesList.siteEntry?.map((site: any) => site.siteUrl).join(', ') || 'None'}`);
  throw new Error(`Service account does not have access to this site. Tried formats: ${siteUrlsToTest.join(', ')}`);
}

/**
 * Extract domain from a URL
 * @param url URL to extract domain from
 * @returns Domain name
 */
export function extractDomain(url: string): string {
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

/**
 * Extract base domain without www prefix
 * @param url URL to extract base domain from
 * @returns Base domain name
 */
export function extractBaseDomain(url: string): string {
  const domain = extractDomain(url);
  return domain.replace(/^www\./, '');
}

/**
 * Extract path from a URL
 * @param url URL to extract path from
 * @returns Path component
 */
export function extractPath(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname;
  } catch (e) {
    // Handle invalid URLs
    const match = url.match(/^(?:https?:\/\/)?[^\/]+(\/.*)?$/i);
    return match && match[1] ? match[1] : '/';
  }
}

// Common API response headers
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};